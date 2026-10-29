package langfuse

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/Tencent/WeKnora/internal/types"
	"github.com/google/uuid"
	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

// The final exporter boundary applies to all spans, including spans created by
// third-party OpenTelemetry instrumentation, not only the Langfuse wrappers.
type privateMetadataExporter struct{ inner sdktrace.SpanExporter }

func (e *privateMetadataExporter) ExportSpans(ctx context.Context, spans []sdktrace.ReadOnlySpan) error {
	safe := make([]sdktrace.ReadOnlySpan, len(spans))
	for i, s := range spans {
		safe[i] = privateMetadataSpan{s}
	}
	return e.inner.ExportSpans(ctx, safe)
}
func (e *privateMetadataExporter) Shutdown(ctx context.Context) error { return e.inner.Shutdown(ctx) }

type privateMetadataSpan struct{ sdktrace.ReadOnlySpan }

func (s privateMetadataSpan) Name() string {
	switch s.ReadOnlySpan.Name() {
	case "chat.completion", "chat.completion.stream", "agent.execute", "agent.round", "agent.tool.search_knowledge", "agent.tool.read_document", "agent.tool.list_documents", "agent.tool.query_knowledge_graph", "agent.tool.thinking", "agent.tool.read_file":
		return s.ReadOnlySpan.Name()
	default:
		return "private.operation"
	}
}
func (s privateMetadataSpan) Events() []sdktrace.Event { return nil }
func (s privateMetadataSpan) Links() []sdktrace.Link   { return nil }
func (s privateMetadataSpan) Status() sdktrace.Status {
	v := s.ReadOnlySpan.Status()
	v.Description = ""
	return v
}
func (s privateMetadataSpan) Attributes() []attribute.KeyValue {
	var out []attribute.KeyValue
	for _, a := range s.ReadOnlySpan.Attributes() {
		switch string(a.Key) {
		case attrObsType:
			v := a.Value.AsString()
			if v == obsTypeTrace || v == obsTypeSpan || v == obsTypeGeneration {
				out = append(out, a)
			}
		case attrObsModel:
			if safeModelName(a.Value.AsString()) {
				out = append(out, a)
			}
		case attrObsUsageDetails:
			var usage TokenUsage
			if json.Unmarshal([]byte(a.Value.AsString()), &usage) == nil {
				if usage.Unit != "TOKENS" {
					usage.Unit = ""
				}
				out = append(out, jsonAttr(attrObsUsageDetails, usage))
			}
		case attrObsCompletionStart:
			if _, err := time.Parse(time.RFC3339Nano, a.Value.AsString()); err == nil {
				out = append(out, a)
			}
		case attrUserID, attrSessionID:
			if safeIdentity(a.Value.AsString()) {
				out = append(out, a)
			}
		case attrEnvironment, attrRelease:
			if safeID(a.Value.AsString()) {
				out = append(out, a)
			}
		case attrTraceName:
			out = append(out, attribute.String(attrTraceName, "private.request"))
		case attrTraceMetadata, attrObsMetadata:
			var raw map[string]interface{}
			if json.Unmarshal([]byte(a.Value.AsString()), &raw) == nil {
				out = append(out, jsonAttr(string(a.Key), privateSafeMetadata(raw)))
			}
		}
	}
	return out
}

// Values are derived from the authenticated context. Call purpose is limited
// to code-defined labels rather than arbitrary metadata supplied by a caller.
func privateAttribution(ctx context.Context, meta map[string]interface{}) map[string]interface{} {
	out := privateSafeMetadata(meta)
	delete(out, "tenant_id")
	delete(out, "user_id")
	if id, ok := types.TenantIDFromContext(ctx); ok {
		out["tenant_id"] = id
	}
	if id, ok := types.UserIDFromContext(ctx); ok {
		out["user_id"] = id
	}
	return out
}
func privateSafeMetadata(meta map[string]interface{}) map[string]interface{} {
	out := map[string]interface{}{}
	for _, key := range []string{"tenant_id", "user_id", "model_id", "call_purpose"} {
		value, ok := meta[key]
		if !ok {
			continue
		}
		switch key {
		case "tenant_id":
			switch value.(type) {
			case uint64, float64:
				out[key] = value
			}
		case "user_id", "model_id":
			if v, ok := value.(string); ok && safeIdentity(v) {
				out[key] = v
			}
		case "call_purpose":
			if v, ok := value.(string); ok && safePurpose(v) {
				out[key] = v
			}
		}
	}
	return out
}
func safeIdentity(v string) bool {
	if _, err := uuid.Parse(v); err == nil {
		return true
	}
	if strings.HasPrefix(v, "system-") {
		for _, r := range strings.TrimPrefix(v, "system-") {
			if r < '0' || r > '9' {
				return false
			}
		}
		return len(v) > len("system-") && len(v) < 32
	}
	return false
}
func safeID(v string) bool {
	if len(v) == 0 || len(v) > 64 {
		return false
	}
	for _, r := range v {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_') {
			return false
		}
	}
	return true
}
func safeModelName(v string) bool {
	if len(v) == 0 || len(v) > 128 {
		return false
	}
	for _, r := range v {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_' || r == '.' || r == '/' || r == ':') {
			return false
		}
	}
	return true
}
func safePurpose(v string) bool {
	switch strings.TrimSpace(v) {
	case "private_route_classification", "session_title", "agent_round", "agent_final_answer", "query_rewrite", "document_summary", "question_generation", "follow_up.suggestions", "data_analysis_plan", "entity_extraction", "knowledge_base_description", "document_auto_tag", "context_compaction", "agent_context_compaction":
		return true
	default:
		return false
	}
}
