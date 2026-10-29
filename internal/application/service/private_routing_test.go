package service

import (
	"context"
	"errors"
	"testing"

	"github.com/Tencent/WeKnora/internal/agent/tools"
	"github.com/Tencent/WeKnora/internal/config"
	"github.com/Tencent/WeKnora/internal/privacy"
	"github.com/Tencent/WeKnora/internal/sandbox"
	"github.com/Tencent/WeKnora/internal/types"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func privateRoutingFixture(t *testing.T) (*PrivateRouter, *gorm.DB, context.Context) {
	t.Helper()
	t.Cleanup(types.OverrideBuiltinAgentEntriesForTest(map[string]*types.BuiltinAgentEntry{
		types.BuiltinQuickAnswerID:    {ID: types.BuiltinQuickAnswerID, Config: types.CustomAgentConfig{AgentMode: types.AgentModeQuickAnswer}},
		types.BuiltinSmartReasoningID: {ID: types.BuiltinSmartReasoningID, Config: types.CustomAgentConfig{AgentMode: types.AgentModeSmartReasoning, MaxIterations: 50, AllowedTools: []string{"search_knowledge", "read_document", "list_documents"}}},
	}))
	t.Setenv("WEKNORA_PRIVATE_ROUTING_ENABLED", "true")
	t.Setenv("WEKNORA_PRIVATE_CHAT_MODEL_ID", "template")
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&types.Model{}, &types.CustomAgent{}, &types.Session{}, &types.Message{}))
	require.NoError(t, db.Create(&types.Model{ID: "template", TenantID: 10000, Name: "deepseek-chat", DisplayName: "DeepSeek Chat Local Mock", Type: types.ModelTypeKnowledgeQA, Source: types.ModelSourceRemote, Status: types.ModelStatusActive, Parameters: types.ModelParameters{APIKey: "operator-secret"}}).Error)
	r := NewPrivateRouter(db, nil, nil)
	r.classify = func(context.Context, string, string) (bool, error) { return false, nil }
	ctx := context.WithValue(context.Background(), types.TenantIDContextKey, uint64(42))
	return r, db, ctx
}

func TestPrivateRouterStickyAndOverrides(t *testing.T) {
	r, db, ctx := privateRoutingFixture(t)
	s := &types.Session{ID: "conversation", TenantID: 42, UserID: "owner"}
	require.NoError(t, db.Create(s).Error)
	ctx = context.WithValue(ctx, types.UserIDContextKey, "owner")
	agent, err := r.Route(ctx, s, "1+1", false)
	require.NoError(t, err)
	require.Equal(t, types.BuiltinSmartReasoningID, agent.ID)
	require.Equal(t, "public", s.PrivacyRoute)
	agent, err = r.Route(ctx, s, "根据知识库回答", true)
	require.NoError(t, err)
	require.Equal(t, privacy.AgentID, agent.ID)
	require.True(t, s.PrivacyLocked)
	require.True(t, s.PrivacyRouteChanged)
	require.Equal(t, privacy.ModelID(42), agent.Config.ModelID)
	var stored types.Model
	require.NoError(t, db.First(&stored, "id = ?", privacy.ModelID(42)).Error)
	require.Empty(t, stored.Parameters.APIKey)

	require.False(t, agent.Config.WebSearchEnabled)
	fresh := &types.Session{}
	require.NoError(t, db.First(fresh, "id = ?", s.ID).Error)
	agent, err = r.Route(ctx, fresh, "现在写一首诗", false)
	require.NoError(t, err)
	require.Equal(t, privacy.AgentID, agent.ID)
	require.False(t, fresh.PrivacyRouteChanged)
	require.Equal(t, "all", agent.Config.KBSelectionMode)
	var count int64
	require.NoError(t, db.Model(&types.CustomAgent{}).Where("tenant_id = ? AND id = ?", 42, privacy.AgentID).Count(&count).Error)
	require.EqualValues(t, 1, count)
}

func TestPrivateRouterClassifierFailureAndLegacyArePrivate(t *testing.T) {
	for _, legacy := range []bool{false, true} {
		t.Run(map[bool]string{false: "failure", true: "legacy"}[legacy], func(t *testing.T) {
			r, db, ctx := privateRoutingFixture(t)
			s := &types.Session{ID: "s", TenantID: 42}
			require.NoError(t, db.Create(s).Error)
			if legacy {
				require.NoError(t, db.Create(&types.Message{ID: "m", SessionID: "s", Role: "user", Content: "old unknown content"}).Error)
			}
			r.classify = func(context.Context, string, string) (bool, error) { return false, errors.New("timeout") }
			agent, err := r.Route(ctx, s, "question", false)
			require.NoError(t, err)
			require.Equal(t, privacy.AgentID, agent.ID)
			require.True(t, s.PrivacyLocked)
		})
	}
}

func TestPrivateRouterRequiresModelAndKeepsTenantScope(t *testing.T) {
	r, db, ctx := privateRoutingFixture(t)
	s := &types.Session{ID: "other", TenantID: 99}
	require.NoError(t, db.Create(s).Error)
	_, err := r.Route(ctx, s, "q", true)
	require.Error(t, err)
	t.Setenv("WEKNORA_PRIVATE_CHAT_MODEL_ID", "missing")
	_, err = r.EnsureAgent(ctx, 42)
	require.Error(t, err)
}

func TestPrivateRouterTurnLockSurvivesClientAndReleases(t *testing.T) {
	r, _, ctx := privateRoutingFixture(t)
	release, err := r.Acquire(ctx, 42, "s")
	require.NoError(t, err)
	_, err = r.Acquire(ctx, 42, "s")
	require.Error(t, err)
	other, err := r.Acquire(ctx, 99, "s")
	require.NoError(t, err)
	other()
	release()
	release()
	next, err := r.Acquire(ctx, 42, "s")
	require.NoError(t, err)
	next()
}

func TestPrivateRouterDoesNotExposeResourcesInPublicMode(t *testing.T) {
	r, db, ctx := privateRoutingFixture(t)
	s := &types.Session{ID: "s", TenantID: 42}
	require.NoError(t, db.Create(s).Error)
	agent, err := r.Route(ctx, s, "你好", false)
	require.NoError(t, err)
	require.Equal(t, "none", agent.Config.KBSelectionMode)
	require.Equal(t, "none", agent.Config.MCPSelectionMode)
	require.Equal(t, "none", agent.Config.SkillsSelectionMode)
	require.NotNil(t, agent.Config.MemoryEnabled)
	require.False(t, *agent.Config.MemoryEnabled)
	require.ElementsMatch(t, []string{"thinking", "final_answer"}, agent.Config.AllowedTools)
}

func TestPrivateRouterInternalUsesSmartReasoningAndUpdatesExistingAgent(t *testing.T) {
	r, db, ctx := privateRoutingFixture(t)
	require.NoError(t, db.Create(&types.CustomAgent{ID: privacy.AgentID, TenantID: 42, Name: "old", Config: types.CustomAgentConfig{AgentMode: types.AgentModeQuickAnswer}}).Error)
	a, err := r.EnsureAgent(ctx, 42)
	require.NoError(t, err)
	require.Equal(t, types.AgentModeSmartReasoning, a.Config.AgentMode)
	require.Equal(t, 50, a.Config.MaxIterations)
	require.Contains(t, a.Config.AllowedTools, "list_documents")
	require.Contains(t, a.Config.AllowedTools, "read_document")
	require.Contains(t, a.Config.AllowedTools, "search_knowledge")
	require.Empty(t, a.Config.RerankModelID)
	require.GreaterOrEqual(t, a.Config.MaxCompletionTokens, 8192)
	var stored types.CustomAgent
	require.NoError(t, db.First(&stored, "id = ? AND tenant_id = ?", privacy.AgentID, 42).Error)
	require.Equal(t, types.AgentModeSmartReasoning, stored.Config.AgentMode)
	require.False(t, stored.Config.WebSearchEnabled)
}

func TestPrivateRouterPreservesSavedSettingsAndEnforcesPrivacy(t *testing.T) {
	r, db, ctx := privateRoutingFixture(t)
	_, err := r.EnsureAgent(ctx, 42)
	require.NoError(t, err)
	var saved types.CustomAgent
	require.NoError(t, db.First(&saved, "id = ? AND tenant_id = ?", privacy.AgentID, 42).Error)
	saved.Config.MaxIterations = 25
	saved.Config.MaxCompletionTokens = 2048
	saved.Config.WebSearchEnabled = true
	saved.Config.ModelID = "external"
	require.NoError(t, db.Save(&saved).Error)
	a, err := r.EnsureAgent(ctx, 42)
	require.NoError(t, err)
	require.Equal(t, 25, a.Config.MaxIterations)
	require.Equal(t, 2048, a.Config.MaxCompletionTokens)
	require.False(t, a.Config.WebSearchEnabled)
	require.Equal(t, privacy.ModelID(42), a.Config.ModelID)
	require.NoError(t, db.First(&saved, "id = ? AND tenant_id = ?", privacy.AgentID, 42).Error)
	require.Equal(t, 25, saved.Config.MaxIterations)
}

func TestPrivateRouterPreservesSelectedWikiReadTools(t *testing.T) {
	r, db, ctx := privateRoutingFixture(t)
	a, err := r.EnsureAgent(ctx, 42)
	require.NoError(t, err)
	a.Config.AllowedTools = []string{tools.ToolWikiSearch, tools.ToolWikiReadPage, tools.ToolWikiWritePage, tools.ToolWebSearch}
	require.NoError(t, db.Save(a).Error)
	a, err = r.EnsureAgent(ctx, 42)
	require.NoError(t, err)
	require.ElementsMatch(t, []string{tools.ToolWikiSearch, tools.ToolWikiReadPage}, a.Config.AllowedTools)
	// The same policy runs on UpdateAgent before the repository write.
	enforcePrivateAgentPolicy(a, 42)
	require.NoError(t, db.Save(a).Error)
	require.NoError(t, db.First(a, "id = ? AND tenant_id = ?", privacy.AgentID, 42).Error)
	require.ElementsMatch(t, []string{tools.ToolWikiSearch, tools.ToolWikiReadPage}, a.Config.AllowedTools)
	a.Config.AllowedTools = []string{tools.ToolWikiReadPage}
	require.NoError(t, db.Save(a).Error)
	a, err = r.EnsureAgent(ctx, 42)
	require.NoError(t, err)
	require.Equal(t, []string{tools.ToolWikiReadPage}, a.Config.AllowedTools)
}

func TestPrivateAgentPreservesAllRequestedToolSelections(t *testing.T) {
	selected := []string{tools.ToolTodoWrite, tools.ToolSearchConversations,
		tools.ToolWikiSearch, tools.ToolWikiReadPage, tools.ToolWikiReadIssue, tools.ToolWikiUpdateIssue,
		tools.ToolDataAnalysis, tools.ToolDataSchema}
	a := &types.CustomAgent{Config: types.CustomAgentConfig{AllowedTools: append(append([]string{}, selected...), tools.ToolWikiDeletePage, tools.ToolWikiFlagIssue, tools.ToolWebSearch, tools.ToolDatabaseQuery)}}
	a.EnsureDefaults()
	enforcePrivateAgentPolicy(a, 42)
	require.ElementsMatch(t, selected, a.Config.AllowedTools)
	// An explicit deselection stays empty, rather than restoring defaults.
	a.Config.AllowedTools = []string{}
	enforcePrivateAgentPolicy(a, 42)
	require.NotNil(t, a.Config.AllowedTools)
	require.Empty(t, a.Config.AllowedTools)
}

func TestPrivateInternalEngineOffersRequestedToolsWithScopeChecks(t *testing.T) {
	t.Setenv("WEKNORA_PRIVATE_ROUTING_ENABLED", "true")
	ctx := privacy.WithRoute(context.WithValue(t.Context(), types.TenantIDContextKey, uint64(7)), "s", true)
	kb := &types.KnowledgeBase{ID: "kb"}
	kb.IndexingStrategy.WikiEnabled = true
	for _, writable := range []bool{false, true} {
		svc := newToolSurfaceService(kb)
		svc.cfg = &config.Config{}
		svc.chunkService = &vectorChunkService{}
		cfg := toolSurfaceConfig(tools.ToolTodoWrite, tools.ToolSearchConversations,
			tools.ToolWikiSearch, tools.ToolWikiReadPage, tools.ToolWikiReadIssue, tools.ToolWikiUpdateIssue,
			tools.ToolDataAnalysis, tools.ToolDataSchema, tools.ToolWikiDeletePage, tools.ToolShellExec)
		if writable {
			cfg.WritableKBIDs = []string{"kb"}
		}
		model := &fakeAgentChatModel{}
		engine, err := svc.CreateAgentEngine(ctx, cfg, model, nil, nil, "s", "m")
		require.NoError(t, err)
		_, err = engine.Execute(ctx, "s", "m", "hello", nil)
		require.NoError(t, err)
		for _, name := range []string{tools.ToolTodoWrite, tools.ToolSearchConversations, tools.ToolWikiSearch, tools.ToolWikiReadPage, tools.ToolWikiReadIssue, tools.ToolDataAnalysis, tools.ToolDataSchema} {
			require.Contains(t, model.lastToolNames, name)
		}
		if writable {
			require.Contains(t, model.lastToolNames, tools.ToolWikiUpdateIssue)
		} else {
			require.NotContains(t, model.lastToolNames, tools.ToolWikiUpdateIssue)
		}
		for _, name := range []string{tools.ToolWikiDeletePage, tools.ToolShellExec, tools.ToolWebSearch, tools.ToolSearchMemory} {
			require.NotContains(t, model.lastToolNames, name)
		}
	}
}

func TestPrivateInternalEngineOffersSelectedWikiReadsOnlyInWikiScope(t *testing.T) {
	t.Setenv("WEKNORA_PRIVATE_ROUTING_ENABLED", "true")
	ctx := privacy.WithRoute(context.WithValue(t.Context(), types.TenantIDContextKey, uint64(7)), "s", true)
	for _, wikiEnabled := range []bool{true, false} {
		kb := &types.KnowledgeBase{ID: "kb"}
		kb.IndexingStrategy.WikiEnabled = wikiEnabled
		svc := newToolSurfaceService(kb)
		svc.cfg = &config.Config{}
		cfg := toolSurfaceConfig(tools.ToolWikiSearch, tools.ToolWikiReadPage, tools.ToolWikiWritePage, tools.ToolWebSearch)
		model := &fakeAgentChatModel{}
		engine, err := svc.CreateAgentEngine(ctx, cfg, model, nil, nil, "s", "m")
		require.NoError(t, err)
		_, err = engine.Execute(ctx, "s", "m", "hello", nil)
		require.NoError(t, err)
		for _, name := range []string{tools.ToolWikiSearch, tools.ToolWikiReadPage} {
			if wikiEnabled {
				require.Contains(t, model.lastToolNames, name)
			} else {
				require.NotContains(t, model.lastToolNames, name)
			}
		}
		for _, name := range []string{tools.ToolWikiWritePage, tools.ToolWebSearch, tools.ToolReadDocument, tools.ToolListDocuments} {
			require.NotContains(t, model.lastToolNames, name)
		}
	}
}

func TestPrivateInternalEngineDoesNotAutoRegisterExternalTools(t *testing.T) {
	t.Setenv("WEKNORA_PRIVATE_ROUTING_ENABLED", "true")
	ctx := context.WithValue(t.Context(), types.TenantIDContextKey, uint64(7))
	ctx = privacy.WithRoute(ctx, "s", true)
	kb := &types.KnowledgeBase{ID: "kb"}
	kb.IndexingStrategy.KeywordEnabled = true
	svc := newToolSurfaceService(kb)
	svc.cfg = &config.Config{PromptTemplates: &config.PromptTemplatesConfig{AgentSystemPrompt: []config.PromptTemplate{{Mode: "rag", Default: true, Content: "SMART_BASE_TEMPLATE"}}}}
	svc.sandboxResolver = stubSandboxResolver{mgr: &capableManager{typ: sandbox.SandboxTypeCube, shell: &stubShellExecutor{}, files: stubSessionFileStore{}}}
	cfg := toolSurfaceConfig(tools.ToolSearchKnowledge, tools.ToolReadDocument, tools.ToolListDocuments, tools.ToolShellExec, tools.ToolSearchConversations)
	cfg.SkillsEnabled = true
	cfg.WebSearchEnabled = true
	cfg.MCPSelectionMode = "all"
	cfg.SandboxConfigID = "sandbox"
	model := &fakeAgentChatModel{}
	engine, err := svc.CreateAgentEngine(ctx, cfg, model, nil, nil, "s", "m")
	require.NoError(t, err)
	_, err = engine.Execute(ctx, "s", "m", "hello", nil)
	require.NoError(t, err)
	require.Contains(t, model.lastToolNames, tools.ToolListDocuments)
	require.Contains(t, model.lastToolNames, tools.ToolSearchConversations)
	require.Contains(t, model.lastSystemPrompt, "SMART_BASE_TEMPLATE")
	require.Contains(t, model.lastSystemPrompt, "不能据此声称是全部患者")
	for _, name := range []string{tools.ToolShellExec, tools.ToolWebSearch, tools.ToolWebFetch, "local_browser"} {
		require.NotContains(t, model.lastToolNames, name)
	}
}

func TestPrivateRerankExemptionIsLimitedToAuthorizedInternalRoute(t *testing.T) {
	t.Setenv("WEKNORA_PRIVATE_ROUTING_ENABLED", "true")
	a := &types.CustomAgent{ID: privacy.AgentID, Config: types.CustomAgentConfig{KBSelectionMode: "all", AllowedTools: privateReadTools()}}
	require.True(t, agentRequiresRerankForRoute(t.Context(), a))
	require.True(t, agentRequiresRerankForRoute(privacy.WithRoute(t.Context(), "s", false), a))
	require.False(t, agentRequiresRerankForRoute(privacy.WithRoute(t.Context(), "s", true), a))
	t.Setenv("WEKNORA_PRIVATE_ROUTING_ENABLED", "false")
	require.True(t, agentRequiresRerankForRoute(privacy.WithRoute(t.Context(), "s", true), a))
}
