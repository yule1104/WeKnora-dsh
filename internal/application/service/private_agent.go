package service

import (
	"context"

	"github.com/Tencent/WeKnora/internal/agent"
	"github.com/Tencent/WeKnora/internal/agent/tools"
	"github.com/Tencent/WeKnora/internal/event"
	"github.com/Tencent/WeKnora/internal/models/chat"
	"github.com/Tencent/WeKnora/internal/privacy"
	"github.com/Tencent/WeKnora/internal/types"
	"github.com/Tencent/WeKnora/internal/types/interfaces"
)

func privateReadTools() []string {
	return []string{tools.ToolSearchKnowledge, tools.ToolReadDocument, tools.ToolListDocuments, tools.ToolQueryKnowledgeGraph, tools.ToolWikiSearch, tools.ToolWikiReadPage, tools.ToolThinking}
}

// Preserve operator selections within the approved native tool boundary.
// Wiki issue status updates are additionally checked against writable KBs by
// registerTools; Wiki content writes and general SQL/shell access stay denied.
// A nil selection inherits read defaults; an explicit empty list stays empty.
func filterPrivateTools(selected []string) []string {
	if selected == nil {
		return privateReadTools()
	}
	allowed := make(map[string]bool)
	for _, name := range append(privateReadTools(), tools.ToolTodoWrite, tools.ToolSearchConversations,
		tools.ToolWikiReadIssue, tools.ToolWikiUpdateIssue, tools.ToolDataAnalysis, tools.ToolDataSchema) {
		allowed[name] = true
	}
	filtered := make([]string, 0, len(selected))
	for _, name := range tools.EffectiveAllowedTools(selected) {
		if allowed[name] {
			filtered = append(filtered, name)
		}
	}
	return filtered
}

func agentRequiresRerankForRoute(ctx context.Context, a *types.CustomAgent) bool {
	// Unapproved auxiliary models must never be substituted on the private route.
	// The native search tool supports deterministic retrieval order without rerank.
	if privacy.Enabled() && privacy.Internal(ctx) && a != nil && a.ID == privacy.AgentID && a.Config.RerankModelID == "" {
		return false
	}
	return agentRequiresRerankModel(a)
}

// Private reasoning deliberately bypasses automatic sandbox, MCP, browser and
// web registrations. Only selected, scoped native tools and this session's
// attachment:// reader are exposed.
func (s *agentService) createPrivateInternalEngine(ctx context.Context, config *types.AgentConfig, model chat.Chat, bus *event.EventBus, sessionID string) (interfaces.AgentEngine, error) {
	safe := *config
	safe.AllowedTools = filterPrivateTools(config.AllowedTools)
	safe.SkillsEnabled = false
	safe.SkillDirs = nil
	safe.TenantSkills = nil
	safe.SandboxConfigID = ""
	safe.AttachmentSandboxCopies = nil
	safe.MCPSelectionMode = "none"
	safe.MCPServices = nil
	safe.LocalBrowserEnabled = false
	safe.WebSearchEnabled = false
	safe.VLMModelID = ""
	disabled := false
	safe.MemoryEnabled = &disabled
	if safe.SystemPrompt == "" {
		if agentHasKnowledgeScope(&safe) {
			safe.SystemPrompt = agent.GetProgressiveRAGSystemPrompt(s.cfg)
		} else {
			safe.SystemPrompt = agent.GetPureAgentSystemPrompt(s.cfg)
		}
	}
	safe.SystemPrompt += `
你是云妆内部问答助手。仅使用当前用户有权访问的内部资料与本会话附件，禁止联网和长期记忆。
仅当运行时提供 search_conversations 工具时，才可按需查阅当前用户本人的历史对话；不得读取其他账号或其他空间的对话。仅当运行时提供 wiki_update_issue 工具且用户具备写权限时，才可更新 Wiki 问题的处理状态；不得创建、覆盖、替换、重命名或删除 Wiki 页面内容。
遇到“多少患者、全部名单、完整统计”等问题，先依据运行时知识库目录、list_documents 的分页和 total 完整核查相关范围，必要时 read_document 核对患者编号并去重。知识库数量、文档数量和患者人数不是同一指标。
search_knowledge 返回的是局部片段，不能据此声称是全部患者或最终总数；尚未完整核查时明确说明覆盖范围，不编造遗漏原因。详情较多时先给可核实的总数和简明名单，再分批展开，避免单轮冗长截断。
`
	safe.UseCustomSystemPrompt = true
	registry := tools.NewToolRegistry()
	if err := s.registerTools(ctx, registry, &safe, nil, model, sessionID); err != nil {
		return nil, err
	}
	s.registerAttachmentReader(ctx, registry, &safe, sessionID)
	registry.BindSession(sessionID)
	kbInfos, docs := s.resolveKBAndDocInfos(ctx, &safe)
	engine := agent.NewAgentEngine(&safe, model, registry, bus, kbInfos, docs, sessionID, safe.SystemPrompt)
	engine.SetAppConfig(s.cfg)
	engine.SetQuestionOrigin(s.resolveQuestionOriginInfo(ctx, safe.QuestionOrigin, safe.SearchTargets, kbInfos))
	return engine, nil
}
