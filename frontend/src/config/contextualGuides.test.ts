import assert from 'node:assert/strict'
import test from 'node:test'
import {
  USER_GUIDES_ENABLED,
  CONTEXTUAL_GUIDE_TOURS,
  isContextualGuideDone,
  isGlobalUserGuideDone,
  openNewUserGuide,
  type ContextualGuideTourId,
} from './contextualGuides'

test('Yunzhuang disables every tour in a fresh browser without reading local completion records', () => {
  assert.equal(USER_GUIDES_ENABLED, false)
  // Node has no browser localStorage: these calls must return before accessing it.
  assert.equal(isGlobalUserGuideDone(), true)
  for (const tour of Object.keys(CONTEXTUAL_GUIDE_TOURS) as ContextualGuideTourId[]) {
    assert.equal(isContextualGuideDone(tour), true, tour)
  }
})

test('manual tour requests do not dispatch browser events while tours are disabled', () => {
  // Node has no window: reopening must be a no-op before accessing browser APIs.
  assert.doesNotThrow(() => openNewUserGuide())
})
