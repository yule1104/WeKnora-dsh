package langfuse

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/Tencent/WeKnora/internal/types"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
)

func TestPrivateMetadataExportDoesNotLeakContent(t *testing.T) {
	exp := tracetest.NewInMemoryExporter()
	t.Setenv("WEKNORA_PRIVATE_ROUTING_ENABLED", "true")
	t.Setenv("WEKNORA_PRIVATE_LANGFUSE_METADATA_ONLY", "true")
	t.Setenv("LANGFUSE_ENABLED", "true")
	t.Setenv("LANGFUSE_PUBLIC_KEY", "pk")
	t.Setenv("LANGFUSE_SECRET_KEY", "sk")
	t.Setenv("LANGFUSE_HOST", "http://test")
	t.Setenv("WEKNORA_PRIVATE_LANGFUSE_TRUSTED_HOST", "http://test")
	cfg := LoadConfigFromEnv()
	cfg.testExporter = exp
	cfg.FlushInterval = time.Second
	m, err := Init(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer m.Shutdown(context.Background())
	ctx := context.WithValue(context.Background(), types.TenantIDContextKey, uint64(42))
	ctx = context.WithValue(ctx, types.UserIDContextKey, "44dad1df-5e16-44ea-9f45-b615979878ab")
	ctx, tr := m.StartTrace(ctx, TraceOptions{Name: "private.request", Input: "CANARY_PRIVATE", Metadata: map[string]interface{}{"query": "CANARY_PRIVATE"}})
	ctx, span := m.StartSpan(ctx, SpanOptions{Name: "agent.execute", Input: "CANARY_PRIVATE", Metadata: map[string]interface{}{"unsafe": "CANARY_PRIVATE"}})
	_, gen := m.StartGeneration(ctx, GenerationOptions{Name: "chat.completion", Model: "test-model", Input: "CANARY_PRIVATE", Metadata: map[string]interface{}{"call_purpose": "agent_round", "unsafe": "CANARY_PRIVATE"}, ModelParameters: map[string]interface{}{"secret": "CANARY_PRIVATE"}})
	gen.Finish("CANARY_PRIVATE", &TokenUsage{Input: 10, Output: 20, Total: 30}, errors.New("CANARY_PRIVATE"))
	_, foreign := m.tracer.Start(ctx, "CANARY_PRIVATE", trace.WithAttributes(attribute.String(attrObsUsageDetails, `{"input":1,"unit":"CANARY_PRIVATE","unknown":"CANARY_PRIVATE"}`), attribute.String(attrSessionID, "CANARY_PRIVATE!"), attribute.String(attrObsType, "CANARY_PRIVATE")))
	foreign.End()
	span.Finish("CANARY_PRIVATE", map[string]interface{}{"other": "CANARY_PRIVATE"}, errors.New("CANARY_PRIVATE"))
	tr.Finish("CANARY_PRIVATE", nil)
	spans := exp.GetSpans()
	if len(spans) != 4 {
		t.Fatalf("spans %d", len(spans))
	}
	var found bool
	for _, s := range spans {
		all := fmt.Sprintf("%s %v %v %v", s.Name, s.Attributes, s.Events, s.Status)
		if strings.Contains(all, "CANARY_PRIVATE") {
			t.Fatalf("private content exported: %s", all)
		}
		if s.Name == "chat.completion" {
			found = true
			if !strings.Contains(spanAttr(s.Attributes, attrObsUsageDetails), `"total":30`) {
				t.Fatal("usage missing")
			}
			meta := spanAttr(s.Attributes, attrObsMetadata)
			if !strings.Contains(meta, `"tenant_id":42`) || !strings.Contains(meta, `"user_id":"44dad1df-5e16-44ea-9f45-b615979878ab"`) || !strings.Contains(meta, `"call_purpose":"agent_round"`) {
				t.Fatalf("attribution missing: %s", meta)
			}
		}
	}
	if !found {
		t.Fatal("generation missing")
	}
}

func TestPrivateTracingRequiresExplicitMetadataOnlyOptIn(t *testing.T) {
	t.Setenv("WEKNORA_PRIVATE_ROUTING_ENABLED", "true")
	t.Setenv("LANGFUSE_ENABLED", "true")
	t.Setenv("LANGFUSE_PUBLIC_KEY", "pk")
	t.Setenv("LANGFUSE_SECRET_KEY", "sk")
	t.Setenv("WEKNORA_PRIVATE_LANGFUSE_METADATA_ONLY", "")
	if LoadConfigFromEnv().Enabled {
		t.Fatal("private tracing must fail closed")
	}
	t.Setenv("WEKNORA_PRIVATE_LANGFUSE_METADATA_ONLY", "true")
	c := LoadConfigFromEnv()
	if !c.Enabled {
		t.Fatal("metadata-only opt-in not enabled")
	}
	if c.Validate() == nil {
		t.Fatal("private host must be explicitly trusted")
	}
	t.Setenv("WEKNORA_PRIVATE_LANGFUSE_TRUSTED_HOST", c.Host)
	if err := LoadConfigFromEnv().Validate(); err != nil {
		t.Fatal(err)
	}
}
