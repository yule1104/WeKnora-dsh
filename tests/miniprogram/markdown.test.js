const assert = require("node:assert/strict");
const test = require("node:test");
const { markdownToNodes } = require("../../miniprogram/utils/markdown");

function plain(nodes) {
  return nodes.map((n) => (n.type === "text" ? n.text : n.name === "br" ? "\n" : plain(n.children || []))).join("");
}
function find(nodes, name, out = []) {
  nodes.forEach((n) => {
    if (n.name === name) out.push(n);
    if (n.children) find(n.children, name, out);
  });
  return out;
}

const SAMPLE = [
  "## 竞品分析概览",
  "",
  "知识库中确实包含一些竞品相关的分析内容，主要集中在**渠道数字化营销**方面，",
  "涉及以下主要竞争对手：",
  "",
  "### 1. **亿滋（Mondelez）**",
  "- **数字化营销平台**：从 VIP Portal 升级为\"亿起积\"",
  "- **营销触点体系**：",
  "  - 工厂 → RDCs → 经销商",
  "  - 盒码、箱码、随机码等多级赋码",
  "",
  "| 品牌 | 平台 |",
  "| --- | --- |",
  "| 亿滋 | 亿起积 |",
  "",
  "```",
  "code **not bold**",
  "```",
  "使用 `wx.request` 与 [文档](https://example.com) *斜体* ~~删除~~"
].join("\n");

test("markdown markers are rendered, not shown", () => {
  const nodes = markdownToNodes(SAMPLE);
  const out = plain(nodes);
  assert.doesNotMatch(out.replace("code **not bold**", ""), /##|\*\*|~~|\]\(|^- /m);
  assert.match(out, /竞品分析概览/);
  assert.match(out, /•数字化营销平台：/);
  assert.match(out, /◦工厂/);
  assert.match(out, /code \*\*not bold\*\*/);
  assert.equal(find(nodes, "strong").length >= 3, true);
  assert.equal(find(nodes, "table").length, 1);
  assert.equal(find(nodes, "td").length, 2);
  assert.equal(find(nodes, "em").length, 1);
});

test("unfinished syntax while streaming stays as plain text", () => {
  const out = plain(markdownToNodes("正在输出 **加"));
  assert.equal(out, "正在输出 **加");
  const fence = markdownToNodes("```js\nconst a = 1;");
  assert.equal(plain(fence), "const a = 1;");
});

test("model output never becomes markup", () => {
  const nodes = markdownToNodes('<img src=x onerror="alert(1)"> <b>hi</b>');
  assert.equal(find(nodes, "img").length, 0);
  assert.equal(find(nodes, "b").length, 0);
  assert.match(plain(nodes), /<img src=x/);
});

test("empty input yields no nodes", () => {
  assert.deepEqual(markdownToNodes(""), []);
  assert.deepEqual(markdownToNodes(null), []);
});
