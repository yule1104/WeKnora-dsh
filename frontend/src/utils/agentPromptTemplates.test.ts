import assert from 'node:assert/strict'
import { test } from 'node:test'
import { brandAgentPromptTemplates, hydrateAgentPromptRefs, serializeAgentPrompts } from './agentPromptTemplates'
import type { CustomAgentConfig } from '../api/agent'
import type { PromptTemplatesConfig } from '../api/system'

const template = (id: string, content: string, extra = {}) => ({ id, name: id, description: '', content, ...extra })
const templates: PromptTemplatesConfig = {
  agent_system_prompt: [template('agent', 'Agent default'), template('wiki', 'Wiki workflow')],
  system_prompt: [template('normal', 'QA default')],
  context_template: [template('context', '{{contexts}}')],
  rewrite: [template('rewrite', 'Rewrite default', { default: true, user: '{{query}}' })],
  fallback: [template('fallback', 'Fallback {{query}}', { default: true, mode: 'model' })],
}

test('untouched templates round trip as references and follow updates in both modes', () => {
  for (const agent_mode of ['smart-reasoning', 'quick-answer'] as const) {
    const input: CustomAgentConfig = {
      agent_mode, system_prompt: agent_mode === 'smart-reasoning' ? 'Wiki workflow' : 'QA default',
      context_template: '{{contexts}}', rewrite_prompt_system: 'Rewrite default', rewrite_prompt_user: '{{query}}',
      fallback_prompt: 'Fallback {{query}}',
    }
    const saved = serializeAgentPrompts(input, templates)
    assert.equal(saved.system_prompt, '')
    assert.equal(saved.context_template, '')
    assert.equal(saved.rewrite_prompt_system, '')
    assert.equal(saved.rewrite_prompt_user, '')
    assert.equal(saved.fallback_prompt, '')
    assert.equal(hydrateAgentPromptRefs(saved, templates).system_prompt, input.system_prompt)
    const updated = structuredClone(templates)
    const list = agent_mode === 'smart-reasoning' ? updated.agent_system_prompt! : updated.system_prompt
    list.find(t => t.id === saved.system_prompt_id)!.content = 'Updated template'
    assert.equal(hydrateAgentPromptRefs(saved, updated).system_prompt, 'Updated template')
    assert.notEqual(input.system_prompt, '', 'serialization must not alter the visible textarea')
  }
})

test('custom and legacy text survives unchanged and stale IDs are removed', () => {
  const input: CustomAgentConfig = {
    agent_mode: 'smart-reasoning', system_prompt_id: 'agent', system_prompt: ' Legacy default with edits\n',
    context_template_id: 'context', context_template: 'Custom {{contexts}}',
    rewrite_prompt_system: 'Custom rewrite', fallback_prompt: 'Custom {{query}}',
  }
  const saved = serializeAgentPrompts(input, templates)
  assert.equal(saved.system_prompt, input.system_prompt)
  assert.equal(saved.context_template, input.context_template)
  assert.equal(saved.system_prompt_id, undefined)
  assert.equal(saved.context_template_id, undefined)
  assert.equal(hydrateAgentPromptRefs(saved, templates).system_prompt, input.system_prompt)
  assert.equal(saved.rewrite_prompt_system, input.rewrite_prompt_system)
  assert.equal(saved.fallback_prompt, input.fallback_prompt)
  assert.deepEqual(serializeAgentPrompts(input, null), input)
})

test('template refs cannot resolve from another mode or field', () => {
  assert.equal(hydrateAgentPromptRefs({ agent_mode: 'quick-answer', system_prompt_id: 'wiki' }, templates).system_prompt, '')
  assert.equal(hydrateAgentPromptRefs({ agent_mode: 'smart-reasoning', system_prompt_id: 'context' }, templates).system_prompt, '')
})

const brandedSource: PromptTemplatesConfig = {
  ...templates,
  agent_system_prompt: [template('upstream-agent', 'You are WeKnora, an assistant developed by Tencent. Help {{knowledge_bases}}.\nRead .weknora/requirements.json', {name:'WeKnora Agent',default:true,mode:'rag'})],
}

test('Yunzhuang template presentation removes upstream identity without mutating source templates', () => {
  const branded = brandAgentPromptTemplates(brandedSource)!
  assert.equal(branded.agent_system_prompt![0].id, 'upstream-agent')
  assert.equal(branded.agent_system_prompt![0].content, 'You are 云妆, an assistant. Help {{knowledge_bases}}.\nRead .weknora/requirements.json')
  assert.equal(branded.agent_system_prompt![0].name, '云妆 Agent')
  assert.ok(brandedSource.agent_system_prompt![0].content.includes('WeKnora'))
  assert.equal(brandAgentPromptTemplates(null), null)
})

test('branded template selection saves actual custom text instead of the upstream template reference', () => {
  const chosen = brandAgentPromptTemplates(brandedSource)!.agent_system_prompt![0]
  const config: CustomAgentConfig = { agent_mode: 'smart-reasoning', system_prompt_id: chosen.id, system_prompt: chosen.content }
  const saved = serializeAgentPrompts(config, brandedSource)
  assert.equal(saved.system_prompt, chosen.content)
  assert.equal(saved.system_prompt_id, undefined)
  assert.equal(hydrateAgentPromptRefs(saved, brandedSource).system_prompt, chosen.content)
})

test('existing upstream template references and exact template bodies display Yunzhuang while custom text remains untouched', () => {
  const expected = brandAgentPromptTemplates(brandedSource)!.agent_system_prompt![0].content
  assert.equal(hydrateAgentPromptRefs({agent_mode:'smart-reasoning', system_prompt_id:'upstream-agent'}, brandedSource).system_prompt, expected)
  assert.equal(hydrateAgentPromptRefs({agent_mode:'smart-reasoning', system_prompt:brandedSource.agent_system_prompt![0].content}, brandedSource).system_prompt, expected)
  const custom = 'My own WeKnora integration instructions must stay exactly as entered.'
  assert.equal(hydrateAgentPromptRefs({agent_mode:'smart-reasoning', system_prompt:custom}, brandedSource).system_prompt, custom)
})
