import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

// Bundle the real Pinia store; replace only API infrastructure unrelated to state.
// This avoids requiring a DOM or making network calls from a state transition test.
test('real settings store enforces SSE lock, reload, and new conversation transitions', async () => {
  const sourceRoot = fileURLToPath(new URL('../', import.meta.url))
  const cacheDir = path.join(sourceRoot, '../node_modules/.cache')
  await mkdir(cacheDir, { recursive: true })
  const output = path.join(cacheDir, `private-routing-store-${process.pid}.mjs`)
  const storage = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  } })
  try {
    await build({
      entryPoints: [path.join(sourceRoot, 'stores/settings.ts')], outfile: output,
      bundle: true, platform: 'node', format: 'esm', external: ['vue', 'pinia'],
      alias: { '@': sourceRoot },
      plugins: [{ name: 'state-api-isolation', setup(builder) {
        builder.onResolve({ filter: /(?:^@\/|\/src\/)(?:api\/agent|utils\/api-base)$/ }, args => ({ path: args.path, namespace: 'state-stub' }))
        builder.onLoad({ filter: /.*/, namespace: 'state-stub' }, args => ({ contents: args.path.endsWith('api-base')
          ? 'export const getApiBaseUrl=()=>"";'
          : 'export const BUILTIN_QUICK_ANSWER_ID="builtin-quick-answer";export const BUILTIN_SMART_REASONING_ID="builtin-smart-reasoning";' }))
      } }],
    })
    const { createPinia, setActivePinia } = await import("pinia")
    const { useSettingsStore } = await import(pathToFileURL(output).href)
    setActivePinia(createPinia())
    const store = useSettingsStore()
    store.configurePrivateRouting(true, true)
    assert.equal(store.selectedAgentId, 'builtin-smart-reasoning')
    store.snapshotAsDefaultsIfNeeded()
    store.applyPrivateRoute({ privacy_locked: true, agent_id: 'yunzhuang-internal-qa', model_id: 'private-model' })
    assert.equal(store.selectedAgentId, 'yunzhuang-internal-qa')
    assert.equal(store.settings.isAgentEnabled, true)
    assert.equal(store.settings.conversationModels.selectedChatModelId, 'private-model')
    store.selectAgent('builtin-smart-reasoning')
    assert.equal(store.selectedAgentId, 'yunzhuang-internal-qa')
    // Reopen with stale UI memo, then apply authoritative server route as the page does.
    store.hydrateSessionInputState({ agent_id: 'builtin-smart-reasoning', agent_enabled: true })
    store.applyPrivateRoute({ privacy_locked: true, effective_agent_id: 'yunzhuang-internal-qa' })
    assert.equal(store.selectedAgentId, 'yunzhuang-internal-qa')
    store.restoreDefaultsIfSnapshotted()
    store.configurePrivateRouting(true, true)
    assert.equal(store.selectedAgentId, 'builtin-smart-reasoning')
    assert.equal(store.privateRoutingLocked, false)
  } finally { await rm(output, { force: true }) }
})
