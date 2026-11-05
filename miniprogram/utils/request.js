const { getSettings } = require("./config");
const { t } = require("./i18n");
const { answerDeltaFromEvent, createSSEParser, errorFromEvent } = require("./sse");
const { createUtf8Decoder } = require("./utf8");

function request(path, options = {}) {
  const settings = getSettings();
  if (!settings.baseUrl) {
    return Promise.reject(new Error(t("missingBaseUrl")));
  }
  if (!settings.apiKey) {
    return Promise.reject(new Error(t("missingApiKey")));
  }

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${settings.baseUrl}${path}`,
      method: options.method || "GET",
      data: options.data,
      header: buildHeaders(settings),
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.data);
          return;
        }
        const data = response.data || {};
        const errorObj = data.error || {};
        const message = errorObj.message || data.message || `HTTP ${response.statusCode}`;
        reject(new Error(message));
      },
      fail(error) {
        reject(new Error(error.errMsg || "Network request failed."));
      }
    });
  });
}

function buildHeaders(settings, extra = {}) {
  return {
    "Content-Type": "application/json",
    "X-API-Key": settings.apiKey,
    "X-Request-ID": `mp-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ...extra
  };
}

function errorMessageFromBody(body, statusCode) {
  let data = body;
  if (typeof body === "string") {
    try {
      data = JSON.parse(body);
    } catch (error) {
      data = {};
    }
  }
  data = data || {};
  const errorObj = data.error || {};
  return errorObj.message || data.message || `HTTP ${statusCode}`;
}

function bodyToText(body) {
  if (typeof body === "string") {
    return body;
  }
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    const decoder = createUtf8Decoder();
    return decoder.write(body) + decoder.end();
  }
  return body ? JSON.stringify(body) : "";
}

const ERROR_BODY_LIMIT = 8192;

// POST/GET an SSE endpoint and deliver each event to onEvent as it arrives.
// Uses wx.request chunked transfer (base library >= 2.20.2). When chunked
// transfer is unavailable the full body is parsed once the request finishes,
// so callers get the same events either way, just not incrementally.
function streamRequest(path, options = {}) {
  const settings = getSettings();
  if (!settings.baseUrl) {
    return Promise.reject(new Error(t("missingBaseUrl")));
  }
  if (!settings.apiKey) {
    return Promise.reject(new Error(t("missingApiKey")));
  }

  const onEvent = typeof options.onEvent === "function" ? options.onEvent : () => {};
  const decoder = createUtf8Decoder();
  const parser = createSSEParser();
  let receivedChunks = false;
  let statusCode = 0;
  let errorBody = "";

  function emit(events) {
    events.forEach((event) => {
      try {
        onEvent(event);
      } catch (error) {
        // a rendering failure must not break the stream
      }
    });
  }

  function isOk(code) {
    return code >= 200 && code < 300;
  }

  function handleText(text) {
    if (!text) return;
    // Keep the head of the body in case the response turns out to be an error.
    if (errorBody.length < ERROR_BODY_LIMIT) errorBody += text;
    if (statusCode && !isOk(statusCode)) return;
    emit(parser.feed(text));
  }

  return new Promise((resolve, reject) => {
    const task = wx.request({
      url: `${settings.baseUrl}${path}`,
      method: options.method || "POST",
      data: options.data,
      enableChunked: true,
      header: buildHeaders(settings, { Accept: "text/event-stream" }),
      success(response) {
        statusCode = response.statusCode;
        if (receivedChunks) {
          handleText(decoder.end());
          if (!isOk(statusCode)) {
            reject(new Error(errorMessageFromBody(errorBody, statusCode)));
            return;
          }
          emit(parser.end());
          resolve({ statusCode, streamed: true });
          return;
        }

        if (!isOk(statusCode)) {
          reject(new Error(errorMessageFromBody(response.data, statusCode)));
          return;
        }
        emit(parser.feed(bodyToText(response.data)));
        emit(parser.end());
        resolve({ statusCode, streamed: false });
      },
      fail(error) {
        reject(new Error((error && error.errMsg) || "Network request failed."));
      }
    });

    if (task && typeof task.onHeadersReceived === "function") {
      task.onHeadersReceived((res) => {
        if (res && res.statusCode) {
          statusCode = res.statusCode;
        }
      });
    }
    if (task && typeof task.onChunkReceived === "function") {
      task.onChunkReceived((res) => {
        receivedChunks = true;
        handleText(decoder.write(res && res.data));
      });
    }
  });
}

function listKnowledgeBases() {
  return request("/api/v1/knowledge-bases");
}

function createKnowledgeFromURL(knowledgeBaseId, url, enableMultimodel = false) {
  return request(`/api/v1/knowledge-bases/${knowledgeBaseId}/knowledge/url`, {
    method: "POST",
    data: {
      url,
      enable_multimodel: enableMultimodel
    }
  });
}

function createSession(knowledgeBaseId) {
  return request("/api/v1/sessions", {
    method: "POST",
    data: knowledgeBaseId ? { knowledge_base_id: knowledgeBaseId } : {}
  });
}

// Streams a knowledge chat answer. handlers.onAnswer(delta, fullAnswer) is
// called for every answer chunk; resolves with the complete answer text.
function knowledgeChat(sessionId, query, knowledgeBaseId, handlers = {}) {
  const data = { query };
  if (knowledgeBaseId) {
    data.knowledge_base_ids = [knowledgeBaseId];
  }

  let answer = "";
  let streamError = "";
  return streamRequest(`/api/v1/knowledge-chat/${sessionId}`, {
    method: "POST",
    data,
    onEvent(event) {
      const delta = answerDeltaFromEvent(event);
      if (delta) {
        answer += delta;
        if (typeof handlers.onAnswer === "function") {
          handlers.onAnswer(delta, answer);
        }
        return;
      }
      const errorMessage = errorFromEvent(event);
      if (errorMessage) {
        streamError = errorMessage;
      }
    }
  }).then(() => {
    if (!answer && streamError) {
      throw new Error(streamError);
    }
    return { answer, error: streamError };
  });
}

module.exports = {
  createKnowledgeFromURL,
  createSession,
  knowledgeChat,
  listKnowledgeBases,
  request,
  streamRequest
};
