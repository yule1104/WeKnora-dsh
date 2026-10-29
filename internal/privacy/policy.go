// Package privacy defines the server-side policy of the dedicated Yunzhuang deployment.
// No browser flag, agent setting, or request model override can enable a public data path.
package privacy

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
)

const AgentID = "yunzhuang-internal-qa"
const AgentName = "云妆内部问答"

type routeKey struct{}
type route struct {
	session  string
	internal bool
}

func Enabled() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv("WEKNORA_PRIVATE_ROUTING_ENABLED")), "true")
}
func TemplateModelID() string { return strings.TrimSpace(os.Getenv("WEKNORA_PRIVATE_CHAT_MODEL_ID")) }
func ModelID(tenant uint64) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("yunzhuang-private-model:%d", tenant)))
	return fmt.Sprintf("%x-%x-%x-%x-%x", sum[:4], sum[4:6], sum[6:8], sum[8:10], sum[10:16])
}
func WithRoute(ctx context.Context, session string, internal bool) context.Context {
	return context.WithValue(ctx, routeKey{}, route{session, internal})
}
func Authorized(ctx context.Context, session string) bool {
	r, ok := ctx.Value(routeKey{}).(route)
	return ok && r.session == session
}
func Internal(ctx context.Context) bool {
	r, ok := ctx.Value(routeKey{}).(route)
	return ok && r.internal
}
func Public(ctx context.Context) bool {
	r, ok := ctx.Value(routeKey{}).(route)
	return ok && !r.internal
}
func CheckModel(ctx context.Context, id string, chat bool, tenantIDs ...uint64) error {
	if !Enabled() {
		return nil
	}
	if chat && Public(ctx) {
		return nil
	}
	if chat && id != "" && id == TemplateModelID() {
		return nil
	}
	if chat && len(tenantIDs) > 0 && id == ModelID(tenantIDs[0]) {
		return nil
	}
	for _, allowed := range strings.Split(os.Getenv("WEKNORA_PRIVATE_AUX_MODEL_IDS"), ",") {
		if id != "" && id == strings.TrimSpace(allowed) {
			return nil
		}
	}
	return fmt.Errorf("private routing blocked unapproved model %s", id)
}

// External ingestion exceptions are capability-specific. A VLM exception must
// never authorize text generation, reranking, or speech processing.
func CheckAuxiliaryModel(ctx context.Context, id, capability string, tenant uint64) error {
	key := ""
	switch capability {
	case "embedding":
		key = "WEKNORA_PRIVATE_ALLOW_EXTERNAL_EMBEDDING"
	case "vlm":
		key = "WEKNORA_PRIVATE_ALLOW_EXTERNAL_VLM"
	}
	if key != "" && id != "" && strings.EqualFold(strings.TrimSpace(os.Getenv(key)), "true") {
		return nil
	}
	return CheckModel(ctx, id, false, tenant)
}

// Malformed, ambiguous and embellished classifier responses are all private.
func ClassifyPrivate(reply string) bool {
	dec := json.NewDecoder(strings.NewReader(strings.TrimSpace(reply)))
	token, err := dec.Token()
	if err != nil || token != json.Delim('{') {
		return true
	}
	key, err := dec.Token()
	if err != nil || key != "route" {
		return true
	}
	var decision string
	if dec.Decode(&decision) != nil {
		return true
	}
	end, err := dec.Token()
	if err != nil || end != json.Delim('}') {
		return true
	}
	_, err = dec.Token()
	return err != io.EOF || decision != "public"
}

func TemplateTenantID() uint64 {
	value, _ := strconv.ParseUint(strings.TrimSpace(os.Getenv("WEKNORA_PRIVATE_CHAT_MODEL_TENANT_ID")), 10, 64)
	if value == 0 {
		return 10000
	}
	return value
}
func ReservedModel(id string, tenant uint64) bool {
	if !Enabled() || id == "" {
		return false
	}
	if id == TemplateModelID() || id == ModelID(tenant) {
		return true
	}
	for _, allowed := range strings.Split(os.Getenv("WEKNORA_PRIVATE_AUX_MODEL_IDS"), ",") {
		if id == strings.TrimSpace(allowed) {
			return true
		}
	}
	return false
}

func CopyRoute(src, dst context.Context) context.Context {
	if r, ok := src.Value(routeKey{}).(route); ok {
		return context.WithValue(dst, routeKey{}, r)
	}
	return dst
}
