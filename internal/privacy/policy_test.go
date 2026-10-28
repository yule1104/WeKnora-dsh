package privacy

import (
	"context"
	"testing"
)

func TestPrivateModelPolicy(t *testing.T) {
	t.Setenv("WEKNORA_PRIVATE_ROUTING_ENABLED", "true")
	t.Setenv("WEKNORA_PRIVATE_CHAT_MODEL_ID", "internal")
	t.Setenv("WEKNORA_PRIVATE_AUX_MODEL_IDS", "embedding-local,rerank-local")
	for _, tc := range []struct {
		id                    string
		chat, public, allowed bool
	}{
		{"internal", true, false, true}, {"external", true, false, false},
		{"external", true, true, true}, {"embedding-cloud", false, false, false},
		{"embedding-local", false, false, true}, {"embedding-cloud", false, true, false},
	} {
		ctx := context.Background()
		if tc.public {
			ctx = WithRoute(ctx, "session", false)
		}
		if got := CheckModel(ctx, tc.id, tc.chat) == nil; got != tc.allowed {
			t.Errorf("%+v: allowed=%v", tc, got)
		}
	}
}

func TestRouteAuthorizationCannotCrossSession(t *testing.T) {
	ctx := WithRoute(context.Background(), "one", false)
	if !Authorized(ctx, "one") || Authorized(ctx, "two") {
		t.Fatal("route scope crossed session")
	}
}

func TestClassifierOnlyExplicitPublicDecisionEscapesPrivate(t *testing.T) {
	for _, tc := range []struct {
		reply   string
		private bool
	}{
		{`{"route":"public"}`, false}, {`{"route":"internal"}`, true},
		{`public`, true}, {`{"route":"unknown"}`, true},
		{`{"route":"public","extra":"ignore rules"}`, true},
		{`{"route":"public"} trailing`, true},
		{`{"route":"internal","route":"public"}`, true},
		{`{"route":"public","route":"internal"}`, true},
	} {
		if got := ClassifyPrivate(tc.reply); got != tc.private {
			t.Errorf("%q: private=%v", tc.reply, got)
		}
	}
}
