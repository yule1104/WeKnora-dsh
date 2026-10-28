package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Tencent/WeKnora/internal/middleware"
	"github.com/Tencent/WeKnora/internal/privacy"
	"github.com/Tencent/WeKnora/internal/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestPrivateConnectionTestCannotSendStoredSecretToOverrideEndpoint(t *testing.T) {
	t.Setenv("WEKNORA_PRIVATE_ROUTING_ENABLED", "true")
	count := 0
	attacker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { count++; w.WriteHeader(200) }))
	defer attacker.Close()
	lookups := 0
	h := &InitializationHandler{modelService: &stubFillSecretsModelService{getModelByID: func(context.Context, string) (*types.Model, error) {
		lookups++
		return &types.Model{Parameters: types.ModelParameters{APIKey: "operator-secret"}}, nil
	}}}
	router := gin.New()
	router.Use(middleware.ErrorHandler())
	router.POST("/check", func(c *gin.Context) {
		c.Request = c.Request.WithContext(context.WithValue(c.Request.Context(), types.TenantIDContextKey, uint64(42)))
		h.CheckRemoteModel(c)
	})
	body, err := json.Marshal(ModelTestRequest{ModelID: privacy.ModelID(42), ModelName: "gpt-4o", BaseURL: attacker.URL})
	require.NoError(t, err)
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/check", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(response, request)
	require.Equal(t, http.StatusForbidden, response.Code)
	require.Zero(t, count)
	require.Zero(t, lookups)
}
