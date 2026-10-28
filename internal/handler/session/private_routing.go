package session

import (
	"context"

	"github.com/Tencent/WeKnora/internal/errors"
	"github.com/Tencent/WeKnora/internal/privacy"
	"github.com/Tencent/WeKnora/internal/types"
	"github.com/gin-gonic/gin"
)

type privateQAPreparer interface {
	PreparePrivateQA(context.Context, *types.Session, string, bool) (context.Context, *types.CustomAgent, func(), error)
}

func privateRequestExplicit(request *CreateKnowledgeQARequest) bool {
	if request.AgentID == privacy.AgentID || len(request.KnowledgeBaseIDs) > 0 || len(request.KnowledgeIDs) > 0 || len(request.TagIDs) > 0 || request.QuestionOrigin != nil || len(request.Images) > 0 || len(request.AttachmentUploads) > 0 || len(request.AttachmentIDs) > 0 {
		return true
	}
	for _, mention := range request.MentionedItems {
		if mention.Type == "kb" || mention.Type == "file" || mention.Type == "tag" {
			return true
		}
	}
	return false
}

func (h *Handler) preparePrivateRequest(ctx context.Context, session *types.Session, request *CreateKnowledgeQARequest) (context.Context, *types.CustomAgent, func(), error) {
	preparer, ok := h.sessionService.(privateQAPreparer)
	if !ok {
		return ctx, nil, nil, errors.NewServiceUnavailableError("private routing unavailable")
	}
	routedCtx, agent, release, err := preparer.PreparePrivateQA(ctx, session, request.Query, privateRequestExplicit(request))
	if err != nil {
		return ctx, nil, nil, errors.NewServiceUnavailableError(err.Error())
	}
	request.AgentID = agent.ID
	request.AgentSourceTenantID = 0
	request.AgentEnabled = agent.IsAgentMode()
	request.SummaryModelID = ""
	request.WebSearchEnabled = false
	request.LocalBrowserEnabled = false
	request.MCPServiceIDs = nil
	request.SkillNames = nil
	mentions := request.MentionedItems[:0]
	for _, mention := range request.MentionedItems {
		if mention.Type == "kb" || mention.Type == "file" || mention.Type == "tag" {
			mentions = append(mentions, mention)
		}
	}
	request.MentionedItems = mentions
	return routedCtx, agent, release, nil
}

func rejectPrivateSteer(c *gin.Context) bool {
	if !privacy.Enabled() {
		return false
	}
	_ = c.Error(errors.NewConflictError("请等待本轮完成后发送，以便重新判断内部知识路由。"))
	return true
}

func privateRouteData(session *types.Session) map[string]interface{} {
	message := ""
	if session.PrivacyRouteChanged {
		message = "已切换至云妆内部问答"
	}
	return map[string]interface{}{"session_id": session.ID, "agent_id": session.EffectiveAgentID, "model_id": session.EffectiveModelID, "agent_name": func() string {
		if session.PrivacyLocked {
			return privacy.AgentName
		}
		return "智能推理"
	}(), "privacy_locked": session.PrivacyLocked, "switched": session.PrivacyRouteChanged, "message": message}
}

func privateRelease(reqCtx *qaRequestContext) {
	if reqCtx != nil && reqCtx.privateRelease != nil {
		reqCtx.privateRelease()
		reqCtx.privateRelease = nil
	}
}
