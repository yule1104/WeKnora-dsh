package session

import (
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
