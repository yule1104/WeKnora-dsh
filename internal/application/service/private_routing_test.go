package service

import (
	"context"
	"errors"
	"testing"

	"github.com/Tencent/WeKnora/internal/privacy"
	"github.com/Tencent/WeKnora/internal/types"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func privateRoutingFixture(t *testing.T) (*PrivateRouter, *gorm.DB, context.Context) {
	t.Helper()
	t.Cleanup(types.OverrideBuiltinAgentEntriesForTest(map[string]*types.BuiltinAgentEntry{
		types.BuiltinQuickAnswerID:    {ID: types.BuiltinQuickAnswerID, Config: types.CustomAgentConfig{AgentMode: types.AgentModeQuickAnswer}},
		types.BuiltinSmartReasoningID: {ID: types.BuiltinSmartReasoningID, Config: types.CustomAgentConfig{AgentMode: types.AgentModeSmartReasoning}},
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
