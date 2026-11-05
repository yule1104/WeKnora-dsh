const { getSettings } = require("../../utils/config");
const { createSession, knowledgeChat } = require("../../utils/request");
const { applyNavTitle, applyTabBar, getMessages, t } = require("../../utils/i18n");
const { markdownToNodes } = require("../../utils/markdown");

// How often streamed text is pushed to the view. setData is relatively costly
// in Mini Programs, so chunks are batched instead of rendered one by one.
const FLUSH_INTERVAL_MS = 80;

let messageSeq = 0;
function nextMessageId() {
  messageSeq += 1;
  return `m${Date.now()}${messageSeq}`;
}

function buildViewModel() {
  const messages = getMessages();
  return {
    chatTitle: messages.chatTitle,
    chatSubtitle: messages.chatSubtitle,
    questionPlaceholder: messages.questionPlaceholder,
    sendText: messages.send,
    newChatText: messages.newChat,
    generatingText: messages.generating,
    emptyChatText: messages.emptyChat
  };
}

Page({
  data: {
    chatTitle: "知识问答",
    chatSubtitle: "向当前选中的AI 助手 知识库提问。",
    questionPlaceholder: "输入你的问题…",
    sendText: "发送",
    newChatText: "新对话",
    generatingText: "正在思考…",
    emptyChatText: "向当前选中的知识库提问，回答会实时显示在这里。",
    messages: [],
    loading: false,
    query: "",
    scrollTop: 0,
    sessionId: ""
  },

  applyI18n() {
    this.setData(buildViewModel());
  },

  onLoad() {
    this._scrollSeq = 0;
    this._flushTimer = null;
    this._pending = null;
    this.applyI18n();
  },

  onShow() {
    try {
      applyTabBar();
      applyNavTitle("navChat");
      this.applyI18n();
    } catch (error) {
      // keep fallback Chinese copy
    }
  },

  onUnload() {
    this.cancelFlush();
  },

  onQueryInput(event) {
    this.setData({ query: event.detail.value });
  },

  nextScrollTop() {
    // scroll-top only scrolls when the value changes, so keep increasing it.
    this._scrollSeq = (this._scrollSeq || 0) + 1;
    return 1000000 + this._scrollSeq;
  },

  cancelFlush() {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
  },

  // Push the latest streamed text to the view now.
  flushPending() {
    this.cancelFlush();
    const pending = this._pending;
    if (!pending) return;
    this._pending = null;
    this.setData({
      [`messages[${pending.index}].content`]: pending.content,
      [`messages[${pending.index}].nodes`]: markdownToNodes(pending.content),
      scrollTop: this.nextScrollTop()
    });
  },

  scheduleUpdate(index, content) {
    this._pending = { index, content };
    if (this._flushTimer) return;
    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      this.flushPending();
    }, FLUSH_INTERVAL_MS);
  },

  newChat() {
    if (this.data.loading) return;
    this.cancelFlush();
    this._pending = null;
    this.setData({ messages: [], sessionId: "", query: "" });
  },

  async ensureSession() {
    if (this.data.sessionId) {
      return this.data.sessionId;
    }

    const settings = getSettings();
    const response = await createSession(settings.selectedKnowledgeBaseId);
    const sessionId = response && response.data ? response.data.id : "";
    if (!sessionId) {
      throw new Error(t("sessionIdMissing"));
    }
    this.setData({ sessionId: sessionId });
    return sessionId;
  },

  async ask() {
    const query = (this.data.query || "").trim();
    if (!query || this.data.loading) return;

    const messages = this.data.messages.concat([
      { id: nextMessageId(), role: "user", content: query, status: "done" },
      { id: nextMessageId(), role: "assistant", content: "", nodes: [], status: "streaming" }
    ]);
    const assistantIndex = messages.length - 1;
    this.setData({
      messages,
      query: "",
      loading: true,
      scrollTop: this.nextScrollTop()
    });

    try {
      const sessionId = await this.ensureSession();
      const settings = getSettings();
      const result = await knowledgeChat(sessionId, query, settings.selectedKnowledgeBaseId, {
        onAnswer: (delta, fullAnswer) => this.scheduleUpdate(assistantIndex, fullAnswer)
      });
      this.flushPending();
      this.setData({
        [`messages[${assistantIndex}].content`]: result.answer || t("emptyAnswer"),
        [`messages[${assistantIndex}].nodes`]: markdownToNodes(result.answer),
        [`messages[${assistantIndex}].status`]: result.answer ? "done" : "error",
        scrollTop: this.nextScrollTop()
      });
    } catch (error) {
      this.flushPending();
      const reason = (error && error.message) || "";
      const current = this.data.messages[assistantIndex] || {};
      const prefix = current.content ? `${current.content}\n\n` : "";
      this.setData({
        [`messages[${assistantIndex}].content`]: `${prefix}${t("chatFailed")}${reason ? `: ${reason}` : ""}`,
        [`messages[${assistantIndex}].status`]: "error",
        scrollTop: this.nextScrollTop()
      });
    } finally {
      this.setData({ loading: false });
    }
  }
});
