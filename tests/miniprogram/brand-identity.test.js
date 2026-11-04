const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');

test('Chinese and English demo copy consistently presents Yunzhuang AI', () => {
  const { MESSAGES } = require('../../miniprogram/utils/i18n');
  assert.equal(MESSAGES.zh.settingsTitle, '连接云妆 AI');
  assert.equal(MESSAGES.zh.askAI, '向云妆 AI 提问');
  assert.equal(MESSAGES.en.askAI, 'Ask Yunzhuang AI');
  for (const messages of Object.values(MESSAGES)) {
    assert.doesNotMatch(JSON.stringify(messages), /weknora|tencent|腾讯/i);
  }
});

test('all answer-generating template paths introduce the Yunzhuang identity', () => {
  for (const file of ['system_prompt.yaml', 'intent_prompts.yaml', 'fallback.yaml', 'agent_system_prompt.yaml']) {
    const text = fs.readFileSync(path.join(root, 'config/prompt_templates', file), 'utf8');
    const bodies = [...text.matchAll(/    content: \|\n((?:      .*\n|\n)*)/g)].map(m => m[1]);
    const identities = bodies.filter(body => /You are .*assistant|You are .*云妆|You are .*WeKnora/i.test(body));
    assert.ok(identities.length > 0, file);
    for (const body of identities) {
      assert.doesNotMatch(body, /You are WeKnora|developed by Tencent/i, file);
      assert.match(body, /云妆 AI/, file);
      assert.match(body, /product identity/i, file);
    }
  }
});

test('renamed settings preserve existing connection details and locale on launch', () => {
  const { getSettings, STORAGE_KEY } = require('../../miniprogram/utils/config');
  const originalWx = global.wx;
  const originalApp = global.App;
  const old = { baseUrl: 'https://ai.example.com', apiKey: 'test-key', selectedKnowledgeBaseId: 'kb-demo', locale: 'en' };
  const store = new Map([['weknora_settings', old]]);
  try {
    global.wx = {
      getStorageSync: key => store.get(key),
      setStorageSync: (key, value) => store.set(key, value),
      removeStorageSync: key => store.delete(key)
    };
    let app;
    global.App = definition => { app = definition; };
    delete require.cache[require.resolve('../../miniprogram/app')];
    require('../../miniprogram/app');
    app.onLaunch();
    assert.equal(STORAGE_KEY, 'yunzhuang_ai_settings');
    assert.deepEqual(getSettings(), old);
    assert.deepEqual(store.get(STORAGE_KEY), old);
    assert.equal(store.has('weknora_settings'), false);
  } finally {
    global.wx = originalWx;
    global.App = originalApp;
  }
});
