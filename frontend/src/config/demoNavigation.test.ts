import assert from 'node:assert/strict'
import test from 'node:test'
import { canShowDemoMenuPath, isDemoAdministrator } from './demoNavigation'

test('ordinary users see chat, knowledge bases, artifacts, toolbox and shared spaces', () => {
  assert.equal(canShowDemoMenuPath('creatChat', false, false), true)
  assert.equal(canShowDemoMenuPath('knowledge-bases', false, false), true)
  assert.equal(canShowDemoMenuPath('artifacts', false, false), true)
  assert.equal(canShowDemoMenuPath('toolbox', false, false), true)
  assert.equal(canShowDemoMenuPath('organizations', false, false), true)
  assert.equal(canShowDemoMenuPath('agents', false, false), false)
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

