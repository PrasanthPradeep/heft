import { createSseParser } from '../sse';

describe('createSseParser', () => {
  it('parses a single data event', () => {
    const parser = createSseParser();
    expect(parser.push('data: {"type":"response.completed"}\n\n')).toEqual([
      { type: 'response.completed' },
    ]);
  });

  it('reassembles events split across chunks', () => {
    const parser = createSseParser();
    expect(parser.push('data: {"type":"response.output_')).toEqual([]);
    expect(parser.push('text.delta","delta":"Hi"}\n\n')).toEqual([
      { type: 'response.output_text.delta', delta: 'Hi' },
    ]);
  });

  it('parses multiple events in one chunk', () => {
    const parser = createSseParser();
    const events = parser.push(
      'event: a\ndata: {"n":1}\n\ndata: {"n":2}\n\n'
    );
    expect(events).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('normalises CRLF line endings', () => {
    const parser = createSseParser();
    expect(parser.push('data: {"n":1}\r\n\r\n')).toEqual([{ n: 1 }]);
  });

  it('joins multi-line data payloads', () => {
    const parser = createSseParser();
    expect(parser.push('data: {"a":\ndata: 1}\n\n')).toEqual([{ a: 1 }]);
  });

  it('skips [DONE] and malformed JSON', () => {
    const parser = createSseParser();
    expect(parser.push('data: [DONE]\n\n')).toEqual([]);
    expect(parser.push('data: {not json}\n\n')).toEqual([]);
  });

  it('ignores keep-alive comments', () => {
    const parser = createSseParser();
    expect(parser.push(': keep-alive\n\n')).toEqual([]);
  });
});
