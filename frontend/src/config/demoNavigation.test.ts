import assert from 'node:assert/strict'
import test from 'node:test'
import { canShowDemoMenuPath, canShowDemoSettingsSection, canShowDemoAgent, isDemoAdministrator } from './demoNavigation'

test('ordinary users see chat, knowledge bases, artifacts, toolbox and agents; shared spaces stay hidden', () => {
  assert.equal(canShowDemoMenuPath('creatChat', false, false), true)
  assert.equal(canShowDemoMenuPath('knowledge-bases', false, false), true)
  assert.equal(canShowDemoMenuPath('artifacts', false, false), true)
  assert.equal(canShowDemoMenuPath('toolbox', false, false), true)
  assert.equal(canShowDemoMenuPath('organizations', false, false), false)
  assert.equal(canShowDemoMenuPath('agents', false, false), true)
  assert.equal(canShowDemoMenuPath('settings', false, false), false)
})

test('system administrators retain every navigation entry', () => {
  assert.equal(isDemoAdministrator(true, false), true)
  assert.equal(canShowDemoMenuPath('settings', true, false), true)
  assert.equal(canShowDemoMenuPath('organizations', true, false), true)
})

test('cross-tenant administrators retain every navigation entry', () => {
  assert.equal(isDemoAdministrator(false, true), true)
  assert.equal(canShowDemoMenuPath('models', false, true), true)
  assert.equal(canShowDemoMenuPath('toolbox', false, true), true)
})


test('ordinary accounts cannot open hidden settings even when they own their workspace', () => {
  for (const section of ['memory', 'weknoracloud', 'vectorstore', 'parser', 'storage', 'sandbox', 'websearch', 'system', 'integrations', 'integration-im', 'integration-api', 'integration-embed', 'integration-mcpserver', 'integration-cli', 'integration-chrome', 'integration-claw', 'integration-future']) {
    assert.equal(canShowDemoSettingsSection(section, false, false), false, section)
  }
  for (const section of ['tenant', 'members', 'chathistory', 'general', 'userprofile', 'mymemory', 'models']) {
    assert.equal(canShowDemoSettingsSection(section, false, false), true, section)
  }
})

test('platform and cross-tenant administrators retain settings visibility', () => {
  for (const section of ['memory', 'weknoracloud', 'vectorstore', 'parser', 'storage', 'sandbox', 'websearch', 'system', 'integration-api']) {
    assert.equal(canShowDemoSettingsSection(section, true, false), true, section)
    assert.equal(canShowDemoSettingsSection(section, false, true), true, section)
  }
})

test('ordinary users see only the builtin smart reasoning agent across all sources', () => {
  assert.equal(canShowDemoAgent('builtin-smart-reasoning', false, false), true)
  for (const id of ['builtin-quick-answer', 'builtin-wiki', 'builtin-data-analyst', 'yunzhuang-internal-qa', 'custom-id', '']) {
    assert.equal(canShowDemoAgent(id, false, false), false, id)
    assert.equal(canShowDemoAgent(id, true, false), true, id)
    assert.equal(canShowDemoAgent(id, false, true), true, id)
  }
})
