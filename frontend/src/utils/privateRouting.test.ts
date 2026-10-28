import test from 'node:test'
import assert from 'node:assert/strict'
import { effectivePrivateAgent, canSelectPrivateAgent, shouldNotifyPrivateRoute } from './privateRouting'

test('server lock overrides stale or forged UI agent state', () => {
 assert.equal(effectivePrivateAgent({ privacy_locked: true, effective_agent_id: 'external' }), 'yunzhuang-internal-qa')
 assert.equal(canSelectPrivateAgent(true, 'builtin-smart-reasoning'), false)
 assert.equal(canSelectPrivateAgent(true, 'yunzhuang-internal-qa'), true)
})
test('public sessions and new conversations use smart reasoning', () => {
 assert.equal(effectivePrivateAgent({ privacy_locked: false }), 'builtin-smart-reasoning')
 assert.equal(canSelectPrivateAgent(false, 'builtin-smart-reasoning'), true)
})

test('switch notification appears once, never on follow-up or reload', () => {
 const switched = { session_id: 's', privacy_locked: true, switched: true }
 assert.equal(shouldNotifyPrivateRoute({ session_id: 's', privacy_locked: false }, switched), true)
 assert.equal(shouldNotifyPrivateRoute(switched, switched), false)
 assert.equal(shouldNotifyPrivateRoute(switched, { ...switched, switched: false }), false)
 assert.equal(shouldNotifyPrivateRoute({ privacy_locked: false }, { ...switched, switched: false }), false)
 assert.equal(shouldNotifyPrivateRoute({ privacy_locked: false }, { privacy_locked: true }), false)
})

test('replayed switch events do not notify while session hydration is pending', () => {
 const switched = { session_id: 's', privacy_locked: true, switched: true }
 assert.equal(shouldNotifyPrivateRoute(null, switched, true), false)
 assert.equal(shouldNotifyPrivateRoute(null, switched, false), true)
})
