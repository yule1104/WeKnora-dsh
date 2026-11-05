// Lightweight Markdown -> <rich-text> nodes converter for chat answers.
// Produces node objects (never HTML strings), so model output cannot inject
// markup. Designed to be re-run on every streaming flush: unfinished syntax
// simply renders as plain text until the closing marker arrives.

const STYLE = {
  p: "margin:0 0 0.6em 0;",
  h1: "font-size:1.3em;font-weight:700;margin:0.7em 0 0.4em 0;line-height:1.4;",
  h2: "font-size:1.2em;font-weight:700;margin:0.7em 0 0.4em 0;line-height:1.4;",
  h3: "font-size:1.08em;font-weight:700;margin:0.6em 0 0.3em 0;line-height:1.4;",
  h4: "font-size:1em;font-weight:700;margin:0.5em 0 0.3em 0;",
  li: "display:flex;margin:0 0 0.3em 0;",
  bullet: "flex-shrink:0;min-width:1.3em;color:#07c05f;font-weight:700;",
  liBody: "flex:1;min-width:0;",
  quote: "margin:0 0 0.6em 0;padding:0.2em 0 0.2em 0.8em;border-left:3px solid #b8ebcc;color:#555555;",
  pre: "margin:0 0 0.6em 0;padding:0.7em 0.8em;background:#f5f7f6;border-radius:6px;font-family:Menlo,Consolas,monospace;font-size:0.86em;line-height:1.5;white-space:pre-wrap;word-break:break-all;",
  code: "padding:0 0.3em;background:#f0f3f2;border-radius:4px;font-family:Menlo,Consolas,monospace;font-size:0.9em;color:#c7254e;",
  hr: "height:1px;margin:0.8em 0;background:#e5e7eb;border:none;",
  strong: "font-weight:700;",
  em: "font-style:italic;",
  del: "text-decoration:line-through;color:#888888;",
  link: "color:#07a052;text-decoration:underline;",
  table: "width:100%;margin:0 0 0.6em 0;border-collapse:collapse;font-size:0.88em;",
  th: "padding:0.35em 0.5em;border:1px solid #e5e7eb;background:#f5f7f6;font-weight:700;text-align:left;",
  td: "padding:0.35em 0.5em;border:1px solid #e5e7eb;text-align:left;"
};

function text(value) {
  return { type: "text", text: value };
}

function el(name, style, children) {
  return { name, attrs: style ? { style } : {}, children: children || [] };
}

// ---------- inline ----------

const INLINE_RE = new RegExp(
  [
    "(`+)([\\s\\S]*?[^`])\\1(?!`)", // 1,2 inline code
    "\\*\\*([\\s\\S]+?)\\*\\*", // 3 bold
    "__([\\s\\S]+?)__", // 4 bold
    "~~([\\s\\S]+?)~~", // 5 strike
    "!\\[([^\\]]*)\\]\\(([^)\\s]*)[^)]*\\)", // 6,7 image -> alt text
    "\\[([^\\]]+)\\]\\(([^)\\s]*)[^)]*\\)", // 8,9 link
    "\\*([^*\\s](?:[^*]*[^*\\s])?)\\*" // 10 italic
  ].join("|"),
  "g"
);

function parseInline(source) {
  const nodes = [];
  if (!source) return nodes;
  let last = 0;
  let match;
  const re = new RegExp(INLINE_RE.source, "g");
  while ((match = re.exec(source)) !== null) {
    if (match.index > last) {
      nodes.push(text(source.slice(last, match.index)));
    }
    if (match[2] !== undefined) {
      nodes.push(el("span", STYLE.code, [text(match[2])]));
    } else if (match[3] !== undefined || match[4] !== undefined) {
      nodes.push(el("strong", STYLE.strong, parseInline(match[3] !== undefined ? match[3] : match[4])));
    } else if (match[5] !== undefined) {
      nodes.push(el("span", STYLE.del, parseInline(match[5])));
    } else if (match[6] !== undefined) {
      if (match[6]) nodes.push(text(`[${match[6]}]`));
    } else if (match[8] !== undefined) {
      nodes.push(el("span", STYLE.link, parseInline(match[8])));
    } else if (match[10] !== undefined) {
      nodes.push(el("em", STYLE.em, parseInline(match[10])));
    }
    last = re.lastIndex;
  }
  if (last < source.length) {
    nodes.push(text(source.slice(last)));
  }
  return nodes;
}

// Join lines inside one paragraph with <br>.
function inlineLines(lines) {
  const nodes = [];
  lines.forEach((line, index) => {
    if (index > 0) nodes.push(el("br"));
    parseInline(line.trim()).forEach((node) => nodes.push(node));
  });
  return nodes;
}

// ---------- blocks ----------

const FENCE_RE = /^\s*(```|~~~)\s*([\w+-]*)\s*$/;
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR_RE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE_RE = /^\s{0,3}>\s?(.*)$/;
const LIST_RE = /^(\s*)([-*+•]|\d{1,3}[.)、])\s+(.*)$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitRow(line) {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|")) row = row.slice(0, -1);
  return row.split("|").map((cell) => cell.trim());
}

function isBlockStart(line, next) {
  return (
    FENCE_RE.test(line) ||
    HEADING_RE.test(line) ||
    HR_RE.test(line) ||
    QUOTE_RE.test(line) ||
    LIST_RE.test(line) ||
    (line.includes("|") && next !== undefined && TABLE_SEP_RE.test(next))
  );
}

function indentWidth(spaces) {
  return spaces.replace(/\t/g, "    ").length;
}

function parseBlocks(lines) {
  const nodes = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    // fenced code block (may be unterminated while streaming)
    const fence = line.match(FENCE_RE);
    if (fence) {
      const body = [];
      i += 1;
      while (i < lines.length && !new RegExp(`^\\s*${fence[1]}\\s*$`).test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // skip closing fence
      nodes.push(el("div", STYLE.pre, [text(body.join("\n"))]));
      continue;
    }

    const heading = line.match(HEADING_RE);
    if (heading) {
      const level = Math.min(heading[1].length, 4);
      nodes.push(el("div", STYLE[`h${level}`], parseInline(heading[2])));
      i += 1;
      continue;
    }

    if (HR_RE.test(line)) {
      nodes.push(el("div", STYLE.hr));
      i += 1;
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const body = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        body.push(lines[i].match(QUOTE_RE)[1]);
        i += 1;
      }
      nodes.push(el("div", STYLE.quote, parseBlocks(body)));
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) {
      const header = splitRow(line);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      const headRow = el("tr", "", header.map((cell) => el("th", STYLE.th, parseInline(cell))));
      const bodyRows = rows.map((cells) =>
        el(
          "tr",
          "",
          header.map((_, index) => el("td", STYLE.td, parseInline(cells[index] || "")))
        )
      );
      nodes.push(el("table", STYLE.table, [el("thead", "", [headRow]), el("tbody", "", bodyRows)]));
      continue;
    }

    if (LIST_RE.test(line)) {
      // Collect list items with their indentation; continuation lines that are
      // indented (or lazily wrapped) belong to the previous item.
      const items = [];
      while (i < lines.length) {
        const current = lines[i];
        const item = current.match(LIST_RE);
        if (item) {
          items.push({ indent: indentWidth(item[1]), marker: item[2], lines: [item[3]] });
          i += 1;
          continue;
        }
        if (!current.trim()) {
          // a blank line ends the list unless the next line continues it
          const next = lines[i + 1];
          if (next !== undefined && (LIST_RE.test(next) || /^\s{2,}\S/.test(next))) {
            i += 1;
            continue;
          }
          break;
        }
        if (items.length && (/^\s{2,}\S/.test(current) || !isBlockStart(current, lines[i + 1]))) {
          items[items.length - 1].lines.push(current.trim());
          i += 1;
          continue;
        }
        break;
      }

      // Map raw indentation to nesting levels.
      const levels = [];
      items.forEach((item) => {
        while (levels.length && item.indent < levels[levels.length - 1]) levels.pop();
        if (!levels.length || item.indent > levels[levels.length - 1]) levels.push(item.indent);
        item.level = levels.length - 1;
      });

      items.forEach((item) => {
        const ordered = /^\d/.test(item.marker);
        const bullet = ordered ? `${item.marker.replace(/[)、]$/, ".")}` : item.level === 0 ? "•" : "◦";
        const style = `${STYLE.li}padding-left:${item.level * 1.2}em;`;
        nodes.push(
          el("div", style, [
            el("span", STYLE.bullet, [text(bullet)]),
            el("div", STYLE.liBody, inlineLines(item.lines))
          ])
        );
      });
      continue;
    }

    // paragraph
    const para = [];
    while (i < lines.length && lines[i].trim() && (para.length === 0 || !isBlockStart(lines[i], lines[i + 1]))) {
      para.push(lines[i]);
      i += 1;
    }
    nodes.push(el("div", STYLE.p, inlineLines(para)));
  }

  return nodes;
}

function markdownToNodes(markdown) {
  if (!markdown || typeof markdown !== "string") {
    return [];
  }
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const nodes = parseBlocks(lines);
  // Drop the outer margins of the first/last block so bubbles don't have extra space.
  const firstNode = nodes[0];
  if (firstNode && firstNode.attrs && firstNode.attrs.style) {
    firstNode.attrs.style += "margin-top:0;";
  }
  const lastNode = nodes[nodes.length - 1];
  if (lastNode && lastNode.attrs && lastNode.attrs.style) {
    lastNode.attrs.style += "margin-bottom:0;";
  }
  return nodes;
}

module.exports = {
  markdownToNodes,
  parseInline
};
