/**
 * A small, dependency-free Markdown parser tuned for chat replies.
 *
 * It is intentionally forgiving: streaming replies are re-parsed on every token,
 * so half-finished markup (an open bold marker, a code fence with no closing
 * line) must degrade to plain text instead of throwing or hiding content.
 *
 * Supported: ATX headings, paragraphs, ordered/unordered/task lists (nested),
 * fenced code blocks, blockquotes, thematic breaks, GFM pipe tables, and the
 * inline styles bold, italic, bold-italic, strikethrough, inline code and links.
 */

export type InlineNode =
  | { type: 'text'; value: string }
  | { type: 'bold'; children: InlineNode[] }
  | { type: 'italic'; children: InlineNode[] }
  | { type: 'boldItalic'; children: InlineNode[] }
  | { type: 'strike'; children: InlineNode[] }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; children: InlineNode[] };

export type ListItem = {
  content: InlineNode[];
  children: BlockNode[];
  /** `null` for a normal item, otherwise whether a task checkbox is checked. */
  task: boolean | null;
};

export type HeadingBlock = { type: 'heading'; level: number; content: InlineNode[] };
export type ParagraphBlock = { type: 'paragraph'; content: InlineNode[] };
export type ListBlock = { type: 'list'; ordered: boolean; start: number; items: ListItem[] };
export type CodeBlock = { type: 'code'; language: string | null; value: string };
export type QuoteBlock = { type: 'quote'; content: InlineNode[] };
export type RuleBlock = { type: 'rule' };
export type TableBlock = { type: 'table'; header: InlineNode[][]; rows: InlineNode[][][] };

export type BlockNode =
  | HeadingBlock
  | ParagraphBlock
  | ListBlock
  | CodeBlock
  | QuoteBlock
  | RuleBlock
  | TableBlock;

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/;
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*)$/;
const RULE_RE = /^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;
const QUOTE_RE = /^\s{0,3}>\s?(.*)$/;
const UL_RE = /^(\s*)[-*+]\s+(.*)$/;
const OL_RE = /^(\s*)(\d{1,3})[.)]\s+(.*)$/;
const TASK_RE = /^\[([ xX])\]\s+(.*)$/;
const ESCAPABLE = '\\`*_{}[]()#+-.!|>~';

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function parseTask(content: string): { checked: boolean; text: string } | null {
  const match = content.match(TASK_RE);
  if (!match) return null;
  return { checked: match[1].toLowerCase() === 'x', text: match[2] };
}

function parseEmphasis(
  text: string,
  index: number,
  marker: string
): { node: InlineNode; next: number } | null {
  let run = 0;
  while (text[index + run] === marker) run += 1;

  const tryWrap = (
    width: number,
    build: (children: InlineNode[]) => InlineNode
  ): { node: InlineNode; next: number } | null => {
    if (run < width) return null;
    const openEnd = index + width;
    const close = text.indexOf(marker.repeat(width), openEnd);
    if (close === -1) return null;

    const inner = text.slice(openEnd, close);
    // Delimiters touching whitespace are not emphasis (`2 * 3 * 4`).
    if (!inner || /^\s/.test(inner) || /\s$/.test(inner)) return null;
    // Intraword underscores are not emphasis (`snake_case_name`).
    if (marker === '_' && /\w/.test(text[index - 1] ?? '') && /\w/.test(text[close + width] ?? '')) {
      return null;
    }
    return { node: build(parseInline(inner)), next: close + width };
  };

  return (
    tryWrap(3, (children) => ({ type: 'boldItalic', children })) ??
    tryWrap(2, (children) => ({ type: 'bold', children })) ??
    tryWrap(1, (children) => ({ type: 'italic', children }))
  );
}

/** Splits a line into inline nodes, tolerating unterminated markers. */
export function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let buffer = '';
  let index = 0;

  const flush = () => {
    if (buffer) {
      nodes.push({ type: 'text', value: buffer });
      buffer = '';
    }
  };

  while (index < text.length) {
    const char = text[index];

    if (char === '\\' && ESCAPABLE.includes(text[index + 1] ?? '')) {
      buffer += text[index + 1];
      index += 2;
      continue;
    }

    if (char === '`') {
      const close = text.indexOf('`', index + 1);
      if (close !== -1) {
        flush();
        nodes.push({ type: 'code', value: text.slice(index + 1, close) });
        index = close + 1;
        continue;
      }
      buffer += char;
      index += 1;
      continue;
    }

    if (char === '~' && text.startsWith('~~', index)) {
      const close = text.indexOf('~~', index + 2);
      const inner = close === -1 ? '' : text.slice(index + 2, close);
      if (inner && !/^\s/.test(inner) && !/\s$/.test(inner)) {
        flush();
        nodes.push({ type: 'strike', children: parseInline(inner) });
        index = close + 2;
        continue;
      }
      buffer += char;
      index += 1;
      continue;
    }

    if (char === '*' || char === '_') {
      const emphasis = parseEmphasis(text, index, char);
      if (emphasis) {
        flush();
        nodes.push(emphasis.node);
        index = emphasis.next;
        continue;
      }
      buffer += char;
      index += 1;
      continue;
    }

    if (char === '[') {
      const labelEnd = text.indexOf(']', index + 1);
      if (labelEnd !== -1 && text[labelEnd + 1] === '(') {
        const hrefEnd = text.indexOf(')', labelEnd + 2);
        if (hrefEnd !== -1) {
          flush();
          nodes.push({
            type: 'link',
            href: text.slice(labelEnd + 2, hrefEnd).trim(),
            children: parseInline(text.slice(index + 1, labelEnd)),
          });
          index = hrefEnd + 1;
          continue;
        }
      }
      buffer += char;
      index += 1;
      continue;
    }

    buffer += char;
    index += 1;
  }

  flush();
  return nodes;
}

function splitRow(line: string): string[] {
  let value = line.trim();
  if (value.startsWith('|')) value = value.slice(1);
  if (value.endsWith('|')) value = value.slice(0, -1);

  const cells: string[] = [];
  let current = '';
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '\\' && value[index + 1] === '|') {
      current += '|';
      index += 1;
      continue;
    }
    if (char === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function isTableDelimiter(line: string, expectedCells: number): boolean {
  const cells = splitRow(line);
  if (cells.length !== expectedCells || cells.length === 0) return false;
  return cells.every((cell) => /^:?-{1,}:?$/.test(cell.replace(/\s/g, '')));
}

function isBlockStart(line: string): boolean {
  if (!line.trim()) return true;
  return (
    FENCE_RE.test(line) ||
    HEADING_RE.test(line) ||
    RULE_RE.test(line) ||
    QUOTE_RE.test(line) ||
    UL_RE.test(line) ||
    OL_RE.test(line)
  );
}

type Marker = {
  indent: number;
  ordered: boolean;
  start: number;
  content: string;
  task: boolean | null;
};

function matchListMarker(line: string): Marker | null {
  const unordered = line.match(UL_RE);
  if (unordered) {
    const task = parseTask(unordered[2]);
    return {
      indent: unordered[1].length,
      ordered: false,
      start: 1,
      content: task ? task.text : unordered[2],
      task: task ? task.checked : null,
    };
  }

  const ordered = line.match(OL_RE);
  if (ordered) {
    const task = parseTask(ordered[3]);
    return {
      indent: ordered[1].length,
      ordered: true,
      start: Number(ordered[2]),
      content: task ? task.text : ordered[3],
      task: task ? task.checked : null,
    };
  }

  return null;
}

function parseList(lines: string[], start: number): { list: ListBlock; next: number } {
  const first = matchListMarker(lines[start])!;
  const baseIndent = first.indent;
  const items: ListItem[] = [];
  let index = start;

  while (index < lines.length) {
    const marker = matchListMarker(lines[index]);
    if (!marker || marker.indent < baseIndent) break;
    if (marker.ordered !== first.ordered) break;

    if (marker.indent > baseIndent) {
      if (items.length === 0) break;
      const nested = parseList(lines, index);
      items[items.length - 1].children.push(nested.list);
      index = nested.next;
      continue;
    }

    const item: ListItem = {
      content: parseInline(marker.content),
      children: [],
      task: marker.task,
    };
    items.push(item);
    index += 1;

    // Fold indented continuation lines into the current item.
    while (
      index < lines.length &&
      lines[index].trim() &&
      !matchListMarker(lines[index]) &&
      indentOf(lines[index]) > baseIndent
    ) {
      item.content = [...item.content, ...parseInline(` ${lines[index].trim()}`)];
      index += 1;
    }
  }

  return {
    list: { type: 'list', ordered: first.ordered, start: first.start, items },
    next: index,
  };
}

function parseTable(lines: string[], start: number): { table: TableBlock; next: number } {
  const header = splitRow(lines[start]).map(parseInline);
  const rows: InlineNode[][][] = [];
  let index = start + 2;

  while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
    rows.push(splitRow(lines[index]).map(parseInline));
    index += 1;
  }

  return { table: { type: 'table', header, rows }, next: index };
}

export function parseMarkdown(source: string): BlockNode[] {
  if (!source) return [];

  const lines = source.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  const blocks: BlockNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(FENCE_RE);
    if (fence) {
      const marker = fence[1][0];
      const width = fence[1].length;
      const body: string[] = [];
      index += 1;
      while (index < lines.length) {
        const closing = lines[index].match(FENCE_RE);
        if (closing && closing[1][0] === marker && closing[1].length >= width) {
          index += 1;
          break;
        }
        body.push(lines[index]);
        index += 1;
      }
      blocks.push({ type: 'code', language: fence[2] || null, value: body.join('\n') });
      continue;
    }

    const heading = line.match(HEADING_RE);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        content: parseInline(heading[2].replace(/\s+#+\s*$/, '').trim()),
      });
      index += 1;
      continue;
    }

    if (RULE_RE.test(line)) {
      blocks.push({ type: 'rule' });
      index += 1;
      continue;
    }

    if (
      line.includes('|') &&
      index + 1 < lines.length &&
      isTableDelimiter(lines[index + 1], splitRow(line).length)
    ) {
      const { table, next } = parseTable(lines, index);
      blocks.push(table);
      index = next;
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length) {
        const match = lines[index].match(QUOTE_RE);
        if (!match) break;
        quoted.push(match[1]);
        index += 1;
      }
      blocks.push({ type: 'quote', content: parseInline(quoted.join(' ').trim()) });
      continue;
    }

    if (matchListMarker(line)) {
      const { list, next } = parseList(lines, index);
      blocks.push(list);
      index = next;
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const candidate = lines[index];
      if (isBlockStart(candidate)) break;
      if (
        candidate.includes('|') &&
        index + 1 < lines.length &&
        isTableDelimiter(lines[index + 1], splitRow(candidate).length)
      ) {
        break;
      }
      paragraph.push(candidate.trim());
      index += 1;
    }

    if (paragraph.length === 0) {
      index += 1;
      continue;
    }
    blocks.push({ type: 'paragraph', content: parseInline(paragraph.join(' ')) });
  }

  return blocks;
}
