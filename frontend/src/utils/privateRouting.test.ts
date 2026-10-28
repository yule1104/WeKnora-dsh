import test from 'node:test'
import assert from 'node:assert/strict'
import { effectivePrivateAgent, canSelectPrivateAgent } from './privateRouting'

test('server lock overrides stale or forged UI agent state', () => {
 assert.equal(effectivePrivateAgent({ privacy_locked: true, effective_agent_id: 'external' }), 'yunzhuang-internal-qa')
 assert.equal(canSelectPrivateAgent(true, 'builtin-smart-reasoning'), false)
 assert.equal(canSelectPrivateAgent(true, 'yunzhuang-internal-qa'), true)
})
test('public sessions and new conversations use smart reasoning', () => {
 assert.equal(effectivePrivateAgent({ privacy_locked: false }), 'builtin-smart-reasoning')
 assert.equal(canSelectPrivateAgent(false, 'builtin-smart-reasoning'), true)
})
