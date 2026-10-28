package session

import (
	"github.com/Tencent/WeKnora/internal/types"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestPrivateRequestIncludesAllExplicitSources(t *testing.T) {
	for _, r := range []*CreateKnowledgeQARequest{
		{KnowledgeBaseIDs: []string{"kb"}}, {KnowledgeIDs: []string{"doc"}},
		{TagIDs: []string{"tag"}}, {MentionedItems: []MentionedItemRequest{{Type: "tag"}}},
		{Images: []ImageAttachment{{Data: "data"}}}, {AttachmentIDs: []string{"file"}},
		{AttachmentUploads: []AttachmentUpload{{Data: "data"}}}, {AgentID: "yunzhuang-internal-qa"},
	} {
		require.True(t, privateRequestExplicit(r))
	}
	require.False(t, privateRequestExplicit(&CreateKnowledgeQARequest{Query: "Hello", AgentID: "builtin-smart-reasoning"}))
}

func TestPrivateRouteNotificationOnlyOnPersistedTransition(t *testing.T) {
	for _, changed := range []bool{false, true} {
		data := privateRouteData(&types.Session{PrivacyLocked: true, PrivacyRouteChanged: changed})
		require.Equal(t, changed, data["switched"])
		require.Equal(t, changed, data["message"] != "")
	}
}
