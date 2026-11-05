// Streaming UTF-8 decoder for wx.request chunked responses.
// Mini Program base libraries do not reliably expose TextDecoder, and a chunk
// boundary can split a multi-byte character (common for Chinese text), so the
// decoder keeps incomplete trailing bytes until the next chunk arrives.

function toUint8Array(input) {
  if (!input) {
    return new Uint8Array(0);
  }
  if (input instanceof Uint8Array) {
    return input;
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  return new Uint8Array(0);
}

// Number of bytes the sequence starting with this lead byte should have.
function sequenceLength(lead) {
  if (lead < 0x80) return 1;
  if (lead >= 0xc2 && lead <= 0xdf) return 2;
  if (lead >= 0xe0 && lead <= 0xef) return 3;
  if (lead >= 0xf0 && lead <= 0xf4) return 4;
  return 0; // invalid lead byte
}

function createUtf8Decoder() {
  let pending = [];

  function decodeBytes(bytes, flush) {
    let out = "";
    let i = 0;
    while (i < bytes.length) {
      const lead = bytes[i];
      const len = sequenceLength(lead);
      if (len === 0) {
        out += "�";
        i += 1;
        continue;
      }
      if (i + len > bytes.length) {
        // Incomplete sequence at the end of this chunk.
        if (flush) {
          out += "�";
          i = bytes.length;
        } else {
          pending = Array.prototype.slice.call(bytes, i);
          return out;
        }
        break;
      }
      let codePoint;
      let valid = true;
      if (len === 1) {
        codePoint = lead;
      } else {
        codePoint = lead & (0xff >> (len + 1));
        for (let k = 1; k < len; k += 1) {
          const b = bytes[i + k];
          if ((b & 0xc0) !== 0x80) {
            valid = false;
            break;
          }
          codePoint = (codePoint << 6) | (b & 0x3f);
        }
      }
      if (!valid) {
        out += "�";
        i += 1;
        continue;
      }
      out += String.fromCodePoint(codePoint);
      i += len;
    }
    pending = [];
    return out;
  }

  return {
    write(chunk) {
      const incoming = toUint8Array(chunk);
      if (!pending.length) {
        return decodeBytes(incoming, false);
      }
      const merged = new Uint8Array(pending.length + incoming.length);
      merged.set(pending, 0);
      merged.set(incoming, pending.length);
      return decodeBytes(merged, false);
    },
    end() {
      if (!pending.length) {
        return "";
      }
      return decodeBytes(Uint8Array.from(pending), true);
    }
  };
}

module.exports = {
  createUtf8Decoder
};
