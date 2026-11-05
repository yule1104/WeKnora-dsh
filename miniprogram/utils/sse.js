function parseBlock(block) {
  const event = { event: "message", data: "" };
  block.split(/\n/).forEach((line) => {
    if (line.startsWith("event:")) {
      event.event = line.slice(6).trim();
    }
    if (line.startsWith("data:")) {
      event.data += line.slice(5).trim();
    }
  });
  return event;
}

function parseSSE(raw) {
  if (!raw || typeof raw !== "string") {
    return [];
  }

  return raw
    .replace(/\r\n?/g, "\n")
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map(parseBlock)
    .filter((event) => event.data);
}

// Returns the answer delta carried by one SSE event, or "" if it carries none.
function answerDeltaFromEvent(event) {
  if (!event || !event.data) {
    return "";
  }
  try {
    const payload = JSON.parse(event.data);
    if (payload && payload.response_type === "answer" && payload.content) {
      return payload.content;
    }
  } catch (error) {
    return "";
  }
  return "";
}

// Returns the error message carried by one SSE event, or "" if it is not an error.
function errorFromEvent(event) {
  if (!event || !event.data) {
    return "";
  }
  try {
    const payload = JSON.parse(event.data);
    if (payload && payload.response_type === "error") {
      return payload.content || "error";
    }
  } catch (error) {
    return "";
  }
  return "";
}

function collectAnswerFromSSE(raw) {
  return parseSSE(raw).reduce((answer, event) => answer + answerDeltaFromEvent(event), "");
}

// Incremental parser: feed text as it arrives; complete events are returned as
// soon as their terminating blank line is seen. Partial events stay buffered.
function createSSEParser() {
  let buffer = "";

  function drain(final) {
    const events = [];
    let index = buffer.indexOf("\n\n");
    while (index !== -1) {
      const block = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 2);
      if (block) {
        const event = parseBlock(block);
        if (event.data) {
          events.push(event);
        }
      }
      index = buffer.indexOf("\n\n");
    }
    if (final) {
      const rest = buffer.trim();
      buffer = "";
      if (rest) {
        const event = parseBlock(rest);
        if (event.data) {
          events.push(event);
        }
      }
    }
    return events;
  }

  return {
    feed(text) {
      if (text) {
        // Normalise CRLF; a lone trailing "\r" may be the first half of "\r\n".
        buffer = (buffer + text).replace(/\r\n/g, "\n").replace(/\r(?!$)/g, "\n");
      }
      return drain(false);
    },
    end() {
      buffer = buffer.replace(/\r/g, "\n");
      return drain(true);
    }
  };
}

module.exports = {
  answerDeltaFromEvent,
  collectAnswerFromSSE,
  createSSEParser,
  errorFromEvent,
  parseSSE
};
