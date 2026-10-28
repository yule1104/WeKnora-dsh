package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Tencent/WeKnora/internal/models/chat"
	"github.com/Tencent/WeKnora/internal/privacy"
	"github.com/Tencent/WeKnora/internal/types"
	"github.com/Tencent/WeKnora/internal/types/interfaces"
	"github.com/Tencent/WeKnora/internal/utils"
	"github.com/stretchr/testify/require"
)

type privateModelRepo struct {
	interfaces.ModelRepository
	models map[string]*types.Model
}

func (r *privateModelRepo) GetByID(_ context.Context, _ uint64, id string) (*types.Model, error) {
	return r.models[id], nil
}

func TestPrivateRuntimeIgnoresTamperedTenantEndpoint(t *testing.T) {
	t.Setenv("WEKNORA_PRIVATE_ROUTING_ENABLED", "true")
	t.Setenv("WEKNORA_PRIVATE_CHAT_MODEL_ID", "template")
	utils.SetSSRFWhitelistFromRaw("127.0.0.1")
	t.Cleanup(utils.ResetSSRFWhitelistForTest)
	trustedCalls, externalCalls := 0, 0
	trusted := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		trustedCalls++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}]}`))
	}))
	defer trusted.Close()
	external := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { externalCalls++; w.WriteHeader(500) }))
	defer external.Close()
	makeModel := func(id, endpoint string) *types.Model {
		return &types.Model{ID: id, Name: "gpt-4o", Type: types.ModelTypeKnowledgeQA, Source: types.ModelSourceRemote, Status: types.ModelStatusActive, Parameters: types.ModelParameters{BaseURL: endpoint, APIKey: "test", Provider: "openai"}}
	}
	id := privacy.ModelID(42)
	svc := &modelService{repo: &privateModelRepo{models: map[string]*types.Model{id: makeModel(id, external.URL+"/v1"), "template": makeModel("template", trusted.URL+"/v1")}}}
	ctx := context.WithValue(context.Background(), types.TenantIDContextKey, uint64(42))
	model, err := svc.GetChatModel(ctx, id)
	require.NoError(t, err)
	_, err = model.Chat(ctx, []chat.Message{{Role: "user", Content: "synthetic internal canary"}}, nil)
	require.NoError(t, err)
	require.Equal(t, 1, trustedCalls)
	require.Zero(t, externalCalls)
}

func TestPrivateDeploymentRejectsReservedModelMutation(t *testing.T) {
	t.Setenv("WEKNORA_PRIVATE_ROUTING_ENABLED", "true")
	t.Setenv("WEKNORA_PRIVATE_CHAT_MODEL_ID", "template")
	ctx := context.WithValue(context.Background(), types.TenantIDContextKey, uint64(42))
	repo := &stubCopyModelRepo{source: &types.Model{ID: privacy.ModelID(42), TenantID: 42}}
	svc := &modelService{repo: repo}
	err := svc.UpdateModel(ctx, &types.Model{ID: privacy.ModelID(42), TenantID: 42})
	require.Error(t, err)
	require.Zero(t, repo.updates)
}

func TestPrivatePublicEngineCannotOfferSandboxFiles(t *testing.T) {
	t.Setenv("WEKNORA_PRIVATE_ROUTING_ENABLED", "true")
	ctx := privacy.WithRoute(context.WithValue(context.Background(), types.TenantIDContextKey, uint64(7)), "s", false)
	model := &fakeAgentChatModel{}
	svc := &agentService{sandboxResolver: stubSandboxResolver{mgr: &capableManager{typ: "cube", files: stubSessionFileStore{}}}}
	engine, err := svc.CreateAgentEngine(ctx, &types.AgentConfig{SandboxConfigID: "cfg-remote", AllowedTools: []string{"thinking", "final_answer"}}, model, nil, nil, "s", "m")
	require.NoError(t, err)
	_, err = engine.Execute(ctx, "s", "m", "hello", nil)
	require.NoError(t, err)
	require.NotContains(t, model.lastToolNames, "read_file")
	require.NotContains(t, model.lastToolNames, "list_sandbox_files")
	require.NotContains(t, model.lastToolNames, "write_sandbox_file")
}

func TestPrivateDeploymentCannotCopyReservedCredentials(t *testing.T) {
	t.Setenv("WEKNORA_PRIVATE_ROUTING_ENABLED", "true")
	ctx := context.WithValue(context.Background(), types.TenantIDContextKey, uint64(42))
	svc := &modelService{}
	_, err := svc.CopyModel(ctx, privacy.ModelID(42), "unmanaged copy")
	require.Error(t, err)
}
