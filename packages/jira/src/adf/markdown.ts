import type { AdfDocument, AdfMark, AdfNode } from './types.js';

/**
 * Converts Markdown to Atlassian Document Format, the only body format the
 * Jira Cloud REST API v3 accepts for descriptions, comments and worklog notes.
 *
 * Supported: headings, paragraphs with hard breaks, nested bullet / numbered
 * lists, task lists, fenced code, block quotes, rules, tables, and the inline
 * marks bold, italic, strike, code and links.
 */
export function markdownToAdf(markdown: string): AdfDocument {
  const ids = { next: 0 };
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  return { type: 'doc', version: 1, content: parseBlocks(lines, ids) };
}

interface IdCounter {
  next: number;
}

const FENCE = /^\s*(`{3,}|~{3,})\s*([^\s`]*)/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TASK_PREFIX = /^\[([ xX])\]\s+(.*)$/;
const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function isBlank(line: string): boolean {
  return line.trim() === '';
}

function indentOf(line: string): number {
  return /^\s*/.exec(line)?.[0].length ?? 0;
}

function startsTable(lines: readonly string[], index: number): boolean {
  const line = lines[index] ?? '';
  const next = lines[index + 1];
  return (
    line.includes('|') && next !== undefined && next.includes('-') && TABLE_DELIMITER.test(next)
  );
}

function startsBlock(lines: readonly string[], index: number): boolean {
  const line = lines[index] ?? '';
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    RULE.test(line) ||
    QUOTE.test(line) ||
    LIST_ITEM.test(line) ||
    startsTable(lines, index)
  );
}

function parseBlocks(lines: readonly string[], ids: IdCounter): AdfNode[] {
  const blocks: AdfNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (isBlank(line)) {
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence?.[1] !== undefined) {
      const marker = fence[1];
      const language = fence[2] ?? '';
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? '').trim().startsWith(marker)) {
        body.push(lines[index] ?? '');
        index += 1;
      }
      index += 1;
      const text = body.join('\n');
      blocks.push({
        type: 'codeBlock',
        ...(language === '' ? {} : { attrs: { language } }),
        ...(text === '' ? {} : { content: [{ type: 'text', text }] }),
      });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading?.[1] !== undefined) {
      const content = parseInline(heading[2] ?? '');
      blocks.push({
        type: 'heading',
        attrs: { level: heading[1].length },
        ...(content.length === 0 ? {} : { content }),
      });
      index += 1;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ type: 'rule' });
      index += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && QUOTE.test(lines[index] ?? '')) {
        quoted.push(QUOTE.exec(lines[index] ?? '')?.[1] ?? '');
        index += 1;
      }
      const content = parseBlocks(quoted, ids);
      blocks.push({
        type: 'blockquote',
        content: content.length === 0 ? [{ type: 'paragraph' }] : content,
      });
      continue;
    }

    if (startsTable(lines, index)) {
      const rows: string[] = [lines[index] ?? ''];
      index += 2;
      while (
        index < lines.length &&
        !isBlank(lines[index] ?? '') &&
        (lines[index] ?? '').includes('|')
      ) {
        rows.push(lines[index] ?? '');
        index += 1;
      }
      blocks.push(buildTable(rows));
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const consumed = parseList(lines, index, ids);
      blocks.push(consumed.node);
      index = consumed.next;
      continue;
    }

    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length && !isBlank(lines[index] ?? '') && !startsBlock(lines, index)) {
      paragraph.push(lines[index] ?? '');
      index += 1;
    }
    blocks.push(buildParagraph(paragraph));
  }
  return blocks;
}

function buildParagraph(lines: readonly string[]): AdfNode {
  const content: AdfNode[] = [];
  lines.forEach((raw, position) => {
    const hardBreak = / {2,}$/.test(raw) || raw.endsWith('\\');
    const text = raw.trim().replace(/\\$/, '');
    content.push(...parseInline(position === 0 ? text : ` ${text}`));
    if (hardBreak && position < lines.length - 1) content.push({ type: 'hardBreak' });
  });
  return content.length === 0 ? { type: 'paragraph' } : { type: 'paragraph', content };
}

interface ListItem {
  readonly text: string;
  readonly children: readonly string[];
  readonly task: 'TODO' | 'DONE' | undefined;
}

function parseList(
  lines: readonly string[],
  start: number,
  ids: IdCounter,
): { node: AdfNode; next: number } {
  const first = LIST_ITEM.exec(lines[start] ?? '');
  const baseIndent = first?.[1]?.length ?? 0;
  const ordered = /\d/.test(first?.[2] ?? '');
  const items: ListItem[] = [];
  let index = start;

  while (index < lines.length) {
    const match = LIST_ITEM.exec(lines[index] ?? '');
    if (match?.[1]?.length !== baseIndent) break;
    if (/\d/.test(match[2] ?? '') !== ordered) break;

    const markerWidth = (match[2] ?? '').length + 1;
    let text = match[3] ?? '';
    let task: ListItem['task'];
    const taskMatch = TASK_PREFIX.exec(text);
    if (taskMatch?.[1] !== undefined) {
      task = taskMatch[1] === ' ' ? 'TODO' : 'DONE';
      text = taskMatch[2] ?? '';
    }

    const children: string[] = [];
    index += 1;
    while (index < lines.length) {
      const next = lines[index] ?? '';
      if (isBlank(next)) {
        const after = lines[index + 1];
        if (after !== undefined && !isBlank(after) && indentOf(after) > baseIndent) {
          children.push('');
          index += 1;
          continue;
        }
        break;
      }
      if (indentOf(next) <= baseIndent) break;
      children.push(next.slice(Math.min(indentOf(next), baseIndent + markerWidth)));
      index += 1;
    }
    items.push({ text, children, task });

    const upcoming = LIST_ITEM.exec(lines[index] ?? '');
    if (upcoming?.[1]?.length !== baseIndent) {
      let probe = index;
      while (probe < lines.length && isBlank(lines[probe] ?? '')) probe += 1;
      const afterBlank = LIST_ITEM.exec(lines[probe] ?? '');
      if (probe > index && afterBlank?.[1]?.length === baseIndent) index = probe;
    }
  }

  const allTasks = items.length > 0 && items.every((item) => item.task !== undefined);
  const hasNested = items.some((item) => item.children.some((child) => child.trim() !== ''));

  if (allTasks && !hasNested) {
    return {
      node: {
        type: 'taskList',
        attrs: { localId: nextId(ids) },
        content: items.map((item) => ({
          type: 'taskItem',
          attrs: { localId: nextId(ids), state: item.task },
          ...inlineContent(item.text),
        })),
      },
      next: index,
    };
  }

  const content = items.map((item): AdfNode => {
    const label =
      item.task === undefined ? item.text : `${item.task === 'DONE' ? '☑' : '☐'} ${item.text}`;
    const nested = parseBlocks(item.children, ids);
    return { type: 'listItem', content: [buildParagraph([label]), ...nested] };
  });
  return {
    node: ordered
      ? { type: 'orderedList', attrs: { order: Number.parseInt(first?.[2] ?? '1', 10) }, content }
      : { type: 'bulletList', content },
    next: index,
  };
}

function nextId(ids: IdCounter): string {
  ids.next += 1;
  return `task-${ids.next}`;
}

function inlineContent(text: string): { content?: AdfNode[] } {
  const content = parseInline(text);
  return content.length === 0 ? {} : { content };
}

function splitRow(row: string): string[] {
  const cells: string[] = [];
  let current = '';
  for (let position = 0; position < row.length; position += 1) {
    const char = row[position] ?? '';
    if (char === '\\' && row[position + 1] === '|') {
      current += '|';
      position += 1;
    } else if (char === '|') {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  const trimmed = row.trim();
  if (trimmed.startsWith('|')) cells.shift();
  if (trimmed.endsWith('|') && !trimmed.endsWith('\\|')) cells.pop();
  return cells.map((cell) => cell.trim());
}

function buildTable(rows: readonly string[]): AdfNode {
  const parsed = rows.map(splitRow);
  const width = Math.max(...parsed.map((cells) => cells.length));
  return {
    type: 'table',
    attrs: { isNumberColumnEnabled: false, layout: 'default' },
    content: parsed.map((cells, rowIndex) => ({
      type: 'tableRow',
      content: Array.from({ length: width }, (_, column): AdfNode => {
        const content = parseInline(cells[column] ?? '');
        return {
          type: rowIndex === 0 ? 'tableHeader' : 'tableCell',
          content: [content.length === 0 ? { type: 'paragraph' } : { type: 'paragraph', content }],
        };
      }),
    })),
  };
}

const ESCAPABLE = '\\`*_{}[]()#+-.!|~>';

function textNode(text: string, marks: readonly AdfMark[]): AdfNode {
  return marks.length === 0 ? { type: 'text', text } : { type: 'text', text, marks };
}

function findClosingBracket(src: string, open: number): number {
  let depth = 0;
  for (let position = open; position < src.length; position += 1) {
    const char = src[position];
    if (char === '\\') position += 1;
    else if (char === '[') depth += 1;
    else if (char === ']') {
      depth -= 1;
      if (depth === 0) return position;
    }
  }
  return -1;
}

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}]/u.test(char);
}

const DELIMITERS: readonly { token: string; mark: string }[] = [
  { token: '**', mark: 'strong' },
  { token: '__', mark: 'strong' },
  { token: '~~', mark: 'strike' },
  { token: '*', mark: 'em' },
  { token: '_', mark: 'em' },
];

function findClosingDelimiter(src: string, token: string, from: number): number {
  let position = from;
  for (;;) {
    position = src.indexOf(token, position);
    if (position === -1) return -1;
    const before = src[position - 1];
    const after = src[position + token.length];
    const escaped = before === '\\';
    const doubled = token.length === 1 && (after === token || before === token);
    const intraword = token === '_' && isWordChar(after);
    if (!escaped && !doubled && !intraword && before !== ' ') return position;
    position += token.length;
  }
}

/** Inline Markdown to ADF text nodes; empty text is never emitted because ADF rejects it. */
export function parseInline(src: string, marks: readonly AdfMark[] = []): AdfNode[] {
  const out: AdfNode[] = [];
  let buffer = '';
  const flush = (): void => {
    if (buffer !== '') out.push(textNode(buffer, marks));
    buffer = '';
  };

  let position = 0;
  scan: while (position < src.length) {
    const char = src[position] ?? '';
    const next = src[position + 1];

    if (char === '\\' && next !== undefined && ESCAPABLE.includes(next)) {
      buffer += next;
      position += 2;
      continue;
    }

    if (char === '`') {
      const end = src.indexOf('`', position + 1);
      if (end > position + 1) {
        flush();
        const link = marks.filter((mark) => mark.type === 'link');
        out.push(textNode(src.slice(position + 1, end), [...link, { type: 'code' }]));
        position = end + 1;
        continue;
      }
    }

    if (char === '[') {
      const close = findClosingBracket(src, position);
      if (close !== -1 && src[close + 1] === '(') {
        const end = src.indexOf(')', close + 2);
        const href = end === -1 ? '' : src.slice(close + 2, end).trim();
        if (href !== '' && !marks.some((mark) => mark.type === 'link')) {
          flush();
          out.push(
            ...parseInline(src.slice(position + 1, close), [
              ...marks,
              { type: 'link', attrs: { href } },
            ]),
          );
          position = end + 1;
          continue;
        }
      }
    }

    for (const { token, mark } of DELIMITERS) {
      if (!src.startsWith(token, position)) continue;
      if (marks.some((existing) => existing.type === mark)) continue;
      if (token === '_' && isWordChar(src[position - 1])) continue;
      const after = src[position + token.length];
      if (after === undefined || after === ' ') continue;
      const end = findClosingDelimiter(src, token, position + token.length);
      if (end <= position + token.length) continue;
      flush();
      out.push(...parseInline(src.slice(position + token.length, end), [...marks, { type: mark }]));
      position = end + token.length;
      continue scan;
    }

    buffer += char;
    position += 1;
  }
  flush();
  return out;
}
