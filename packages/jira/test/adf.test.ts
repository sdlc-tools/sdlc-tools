import { describe, expect, it } from 'vitest';
import { adfToText, markdownToAdf, type AdfNode } from '../src/index.js';

const blocks = (markdown: string): readonly AdfNode[] => markdownToAdf(markdown).content;
const text = (value: string, ...marks: string[]): AdfNode => ({
  type: 'text',
  text: value,
  ...(marks.length === 0 ? {} : { marks: marks.map((type) => ({ type })) }),
});

describe('markdownToAdf', () => {
  it('wraps blocks in a version 1 document', () => {
    expect(markdownToAdf('Hello')).toEqual({
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph', content: [text('Hello')] }],
    });
  });

  it('keeps an empty input a valid, empty document', () => {
    expect(blocks('')).toEqual([]);
    expect(blocks('  \n\n')).toEqual([]);
  });

  it('joins soft-wrapped lines with a space and honours hard breaks', () => {
    expect(blocks('one\ntwo')).toEqual([
      { type: 'paragraph', content: [text('one'), text(' two')] },
    ]);
    expect(blocks('one  \ntwo')).toEqual([
      { type: 'paragraph', content: [text('one'), { type: 'hardBreak' }, text(' two')] },
    ]);
  });

  it('converts headings with their level', () => {
    expect(blocks('## Plan')).toEqual([
      { type: 'heading', attrs: { level: 2 }, content: [text('Plan')] },
    ]);
  });

  it('converts inline marks and links, including marks inside a link', () => {
    const [paragraph] = blocks(
      'a **bold** *it* ~~old~~ `code` [**site**](https://docs.example.test)',
    );
    expect(paragraph?.content).toEqual([
      text('a '),
      text('bold', 'strong'),
      text(' '),
      text('it', 'em'),
      text(' '),
      text('old', 'strike'),
      text(' '),
      text('code', 'code'),
      text(' '),
      {
        type: 'text',
        text: 'site',
        marks: [{ type: 'link', attrs: { href: 'https://docs.example.test' } }, { type: 'strong' }],
      },
    ]);
  });

  it('does not treat snake_case or a lone asterisk as emphasis', () => {
    expect(blocks('use some_var_name and 2 * 3')).toEqual([
      { type: 'paragraph', content: [text('use some_var_name and 2 * 3')] },
    ]);
  });

  it('honours backslash escapes', () => {
    expect(blocks('\\*not bold\\*')).toEqual([
      { type: 'paragraph', content: [text('*not bold*')] },
    ]);
  });

  it('converts fenced code with its language, and keeps blank lines inside', () => {
    expect(blocks('```ts\nconst a = 1;\n\nconst b = 2;\n```')).toEqual([
      {
        type: 'codeBlock',
        attrs: { language: 'ts' },
        content: [{ type: 'text', text: 'const a = 1;\n\nconst b = 2;' }],
      },
    ]);
  });

  it('converts nested bullet and numbered lists', () => {
    const [list] = blocks('- one\n  - inner\n- two\n\n1. first\n2. second');
    expect(list).toEqual({
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [text('one')] },
            {
              type: 'bulletList',
              content: [
                { type: 'listItem', content: [{ type: 'paragraph', content: [text('inner')] }] },
              ],
            },
          ],
        },
        { type: 'listItem', content: [{ type: 'paragraph', content: [text('two')] }] },
      ],
    });
    expect(blocks('1. first\n2. second')[0]?.type).toBe('orderedList');
  });

  it('gives every task list and item its own localId', () => {
    const [first, second] = blocks('- [ ] write\n- [x] test\n\ntext\n\n- [ ] ship');
    const ids = [
      first?.attrs?.localId,
      ...(first?.content ?? []).map((item) => item.attrs?.localId),
      blocks('- [ ] ship')[0]?.attrs?.localId,
    ];
    expect(first?.type).toBe('taskList');
    expect(first?.content?.map((item) => item.attrs?.state)).toEqual(['TODO', 'DONE']);
    expect(second?.type).toBe('paragraph');
    expect(new Set(ids.slice(0, 3)).size).toBe(3);
    expect(blocks('- [ ] a')[0]?.attrs?.localId).toBe('task-1');
  });

  it('falls back to a bullet list when a task has nested content', () => {
    const [list] = blocks('- [x] done\n  - detail');
    expect(list?.type).toBe('bulletList');
    expect(adfToText(markdownToAdf('- [x] done\n  - detail'))).toBe('- ☑ done\n  - detail');
  });

  it('converts block quotes, rules and tables', () => {
    expect(blocks('> quoted')[0]).toEqual({
      type: 'blockquote',
      content: [{ type: 'paragraph', content: [text('quoted')] }],
    });
    expect(blocks('---')).toEqual([{ type: 'rule' }]);

    const [table] = blocks('| a | b |\n| --- | --- |\n| 1 | 2 \\| 3 |');
    expect(table?.type).toBe('table');
    const rows = table?.content ?? [];
    expect(rows.map((row) => row.content?.map((cell) => cell.type))).toEqual([
      ['tableHeader', 'tableHeader'],
      ['tableCell', 'tableCell'],
    ]);
    expect(rows[1]?.content?.[1]?.content?.[0]?.content?.[0]?.text).toBe('2 | 3');
  });

  it('never emits an empty text node', () => {
    const json = JSON.stringify(markdownToAdf('****\n\n`` \n\n[](x)\n\n#\n'));
    expect(json).not.toContain('"text":""');
  });
});

describe('adfToText', () => {
  it('returns an empty string for anything that is not a document', () => {
    expect(adfToText(null)).toBe('');
    expect(adfToText('plain')).toBe('');
    expect(adfToText({})).toBe('');
  });

  it('round-trips the supported Markdown', () => {
    const markdown = [
      '# Title',
      '',
      'Some **bold**, *italic* and `code` with a [link](https://docs.example.test).',
      '',
      '- one',
      '  - nested',
      '- two',
      '',
      '1. first',
      '2. second',
      '',
      '- [ ] open',
      '- [x] closed',
      '',
      '```ts',
      'const a = 1;',
      '```',
      '',
      '> quoted',
      '',
      '---',
      '',
      '| a | b |',
      '| --- | --- |',
      '| 1 | 2 |',
    ].join('\n');
    expect(adfToText(markdownToAdf(markdown))).toBe(markdown);
  });

  it('renders what Markdown cannot produce without dropping it', () => {
    const document = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Ping ' },
            { type: 'mention', attrs: { id: 'abc', text: '@Ada' } },
            { type: 'text', text: ' ' },
            { type: 'emoji', attrs: { shortName: ':tada:', text: '🎉' } },
            { type: 'hardBreak' },
            { type: 'inlineCard', attrs: { url: 'https://docs.example.test/page' } },
            { type: 'text', text: ' ' },
            { type: 'status', attrs: { text: 'IN REVIEW' } },
            { type: 'text', text: ' ' },
            { type: 'date', attrs: { timestamp: String(Date.UTC(2026, 0, 2)) } },
          ],
        },
        {
          type: 'panel',
          attrs: { panelType: 'warning' },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Careful' }] }],
        },
        { type: 'mediaSingle', content: [{ type: 'media', attrs: { alt: 'screenshot.png' } }] },
        {
          type: 'unknownBlock',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'kept' }] }],
        },
      ],
    };
    expect(adfToText(document)).toBe(
      [
        'Ping @Ada 🎉',
        'https://docs.example.test/page [IN REVIEW] 2026-01-02',
        '',
        '> [warning] Careful',
        '',
        '[attachment: screenshot.png]',
        '',
        'kept',
      ].join('\n'),
    );
  });
});
