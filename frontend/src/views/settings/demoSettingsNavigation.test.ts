import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { computed } from 'vue'
import { canShowDemoSettingsSection } from '../../config/demoNavigation'
import { INTEGRATION_PREVIEW_ITEMS, INTEGRATION_TAB_MIN_ROLE } from '../../config/integrations'
import { SETTINGS_SECTION_MIN_ROLE, SYSTEM_ADMIN_SETTINGS_SECTIONS } from '../../config/settingsAccess'
import { integrationSectionKey, integrationTabFromSection, isIntegrationSection, normalizeSettingsSection as normalizeSettingsSectionFromQuery } from '../../config/settingsRoute'

const source = readFileSync(new URL('./Settings.vue', import.meta.url), 'utf8')
const script = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]!
const ast = ts.createSourceFile('Settings.ts', script, ts.ScriptTarget.Latest, true)
const names = ['normalizeSettingsSection', 'canSeeSection', 'navItems', 'navGroups']
const declarations = ast.statements.filter((s) => ts.isVariableStatement(s) && s.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && names.includes(d.name.text)))
assert.equal(declarations.length, names.length)
const code = ts.transpileModule(declarations.map((s) => s.getText(ast)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
function navigation(admin: boolean) {
  return runInNewContext(`${code}\n({keys: navItems.value.map(x => x.key), groups: navGroups.value.map(x => x.key), normalized: ['memory','weknoracloud','api','integrations','sandbox','system'].map(normalizeSettingsSection)})`, {
    computed, canShowDemoSettingsSection, INTEGRATION_PREVIEW_ITEMS, INTEGRATION_TAB_MIN_ROLE,
    SETTINGS_SECTION_MIN_ROLE, SYSTEM_ADMIN_SECTIONS: SYSTEM_ADMIN_SETTINGS_SECTIONS,
    integrationSectionKey, integrationTabFromSection, isIntegrationSection, normalizeSettingsSectionFromQuery,
    authStore: { isSystemAdmin: admin, canAccessAllTenants: false, currentTenantRole: 'owner', hasRole: () => true },
    route: { query: {} }, isSectionSupported: () => true, envNavLabel: () => 'env', t: (s: string) => s,
  }) as {keys: string[]; groups: string[]; normalized: string[]}
}

test('ordinary workspace owners retain workspace settings but lose restricted groups and direct links', () => {
  const result = navigation(false)
  for (const key of ['tenant', 'members', 'chathistory', 'models', 'mymemory']) assert.ok(result.keys.includes(key), key)
  for (const key of ['memory', 'weknoracloud', 'vectorstore', 'parser', 'storage', 'sandbox', 'websearch', 'system']) assert.ok(!result.keys.includes(key), key)
  for (const group of ['integrations', 'data_extensions', 'platform']) assert.ok(!result.groups.includes(group), group)
  assert.ok(result.keys.every((key) => !key.startsWith('integration-')))
  assert.deepEqual(Array.from(result.normalized), Array(6).fill('tenant'))
})

test('platform administrators retain all restricted settings groups and links', () => {
  const result = navigation(true)
  for (const group of ['integrations', 'data_extensions', 'platform']) assert.ok(result.groups.includes(group), group)
  assert.deepEqual(Array.from(result.normalized), ['memory','weknoracloud','integration-api','integration-im','sandbox','system'])
})
