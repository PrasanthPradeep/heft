import {
  parseInline,
  parseMarkdown,
  type InlineNode,
} from '../markdown';

function plain(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
          return node.value;
        case 'code':
          return node.value;
        default:
          return plain(node.children);
      }
    })
    .join('');
}

describe('parseInline', () => {
  it('returns a single text node for plain input', () => {
    expect(parseInline('just words')).toEqual([
      { type: 'text', value: 'just words' },
    ]);
  });

  it('parses bold, italic and bold-italic', () => {
    expect(parseInline('a **b** c')).toEqual([
      { type: 'text', value: 'a ' },
      { type: 'bold', children: [{ type: 'text', value: 'b' }] },
      { type: 'text', value: ' c' },
    ]);
    expect(parseInline('*i*')).toEqual([
      { type: 'italic', children: [{ type: 'text', value: 'i' }] },
    ]);
    expect(parseInline('***both***')).toEqual([
      { type: 'boldItalic', children: [{ type: 'text', value: 'both' }] },
    ]);
  });

  it('parses inline code, strikethrough and links', () => {
    expect(parseInline('use `npm i`')).toEqual([
      { type: 'text', value: 'use ' },
      { type: 'code', value: 'npm i' },
    ]);
    expect(parseInline('~~gone~~')).toEqual([
      { type: 'strike', children: [{ type: 'text', value: 'gone' }] },
    ]);
    expect(parseInline('[docs](https://example.com)')).toEqual([
      {
        type: 'link',
        href: 'https://example.com',
        children: [{ type: 'text', value: 'docs' }],
      },
    ]);
  });

  it('leaves unterminated markers as literal text', () => {
    expect(parseInline('**bold')).toEqual([{ type: 'text', value: '**bold' }]);
    expect(parseInline('`code')).toEqual([{ type: 'text', value: '`code' }]);
    expect(parseInline('[label](')).toEqual([
      { type: 'text', value: '[label](' },
    ]);
  });

  it('does not italicise arithmetic or snake_case', () => {
    expect(plain(parseInline('2 * 3 * 4'))).toBe('2 * 3 * 4');
    expect(parseInline('snake_case_name')).toEqual([
      { type: 'text', value: 'snake_case_name' },
    ]);
  });

  it('honours backslash escapes', () => {
    expect(parseInline('a \\* b')).toEqual([{ type: 'text', value: 'a * b' }]);
    expect(parseInline('\\`not code\\`')).toEqual([
      { type: 'text', value: '`not code`' },
    ]);
  });
});

describe('parseMarkdown blocks', () => {
  it('returns nothing for empty or whitespace input', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('   \n\n  ')).toEqual([]);
  });

  it('parses headings and strips trailing hashes', () => {
    expect(parseMarkdown('## Title ##')).toEqual([
      { type: 'heading', level: 2, content: [{ type: 'text', value: 'Title' }] },
    ]);
  });

  it('joins wrapped paragraph lines', () => {
    expect(parseMarkdown('line one\nline two')).toEqual([
      {
        type: 'paragraph',
        content: [{ type: 'text', value: 'line one line two' }],
      },
    ]);
  });

  it('parses nested unordered lists', () => {
    const blocks = parseMarkdown('- one\n- two\n  - two a\n- three');
    expect(blocks).toHaveLength(1);
    const list = blocks[0];
    if (list.type !== 'list') throw new Error('expected a list');
    expect(list.ordered).toBe(false);
    expect(list.items.map((item) => plain(item.content))).toEqual([
      'one',
      'two',
      'three',
    ]);
    expect(list.items[1].children).toHaveLength(1);
    const nested = list.items[1].children[0];
    if (nested.type !== 'list') throw new Error('expected a nested list');
    expect(nested.items.map((item) => plain(item.content))).toEqual(['two a']);
  });

  it('parses ordered lists with a start number', () => {
    const blocks = parseMarkdown('3. three\n4. four');
    const list = blocks[0];
    if (list.type !== 'list') throw new Error('expected a list');
    expect(list.ordered).toBe(true);
    expect(list.start).toBe(3);
    expect(list.items).toHaveLength(2);
  });

  it('parses task list checkboxes', () => {
    const blocks = parseMarkdown('- [x] done\n- [ ] todo');
    const list = blocks[0];
    if (list.type !== 'list') throw new Error('expected a list');
    expect(list.items[0].task).toBe(true);
    expect(list.items[1].task).toBe(false);
    expect(plain(list.items[0].content)).toBe('done');
  });

  it('parses fenced code blocks with a language', () => {
    expect(parseMarkdown('```json\n{"a":1}\n```')).toEqual([
      { type: 'code', language: 'json', value: '{"a":1}' },
    ]);
  });

  it('parses an unterminated fence as a code block (streaming)', () => {
    expect(parseMarkdown('```js\nlet a = 1')).toEqual([
      { type: 'code', language: 'js', value: 'let a = 1' },
    ]);
  });

  it('parses blockquotes and thematic breaks', () => {
    expect(parseMarkdown('> one\n> two')).toEqual([
      { type: 'quote', content: [{ type: 'text', value: 'one two' }] },
    ]);
    expect(parseMarkdown('---')).toEqual([{ type: 'rule' }]);
  });

  it('parses a GFM table with inline formatting', () => {
    const blocks = parseMarkdown(
      '| Day | Weight |\n| --- | --- |\n| Mon | **80** |'
    );
    const table = blocks[0];
    if (table.type !== 'table') throw new Error('expected a table');
    expect(table.header.map(plain)).toEqual(['Day', 'Weight']);
    expect(table.rows).toHaveLength(1);
    expect(plain(table.rows[0][0])).toBe('Mon');
    expect(table.rows[0][1]).toEqual([
      { type: 'bold', children: [{ type: 'text', value: '80' }] },
    ]);
  });

  it('does not treat a lone dashes line as a table', () => {
    expect(parseMarkdown('text\n---')).toEqual([
      { type: 'paragraph', content: [{ type: 'text', value: 'text' }] },
      { type: 'rule' },
    ]);
  });

  it('keeps a mix of blocks in order', () => {
    const blocks = parseMarkdown(
      '# Report\n\nToday was good.\n\n- point one\n- point two\n\n> note'
    );
    expect(blocks.map((block) => block.type)).toEqual([
      'heading',
      'paragraph',
      'list',
      'quote',
    ]);
  });
});
