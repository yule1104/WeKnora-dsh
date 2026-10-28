import test from 'node:test'
import assert from 'node:assert/strict'
import { canShowDemoAgent } from '../config/demoNavigation'

test('ordinary customers can see the routed internal agent alongside smart reasoning', () => {
  assert.equal(canShowDemoAgent('yunzhuang-internal-qa', false, false), true)
  assert.equal(canShowDemoAgent('builtin-smart-reasoning', false, false), true)
  assert.equal(canShowDemoAgent('builtin-quick-answer', false, false), false)
  assert.equal(canShowDemoAgent('other-agent', false, false), false)
})
