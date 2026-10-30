import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('shared mini program configuration does not contain an application ID', () => {
  const config = JSON.parse(readFileSync(new URL('./project.config.json', import.meta.url), 'utf8'))
  assert.equal(Object.hasOwn(config, 'appid'), false)
})
