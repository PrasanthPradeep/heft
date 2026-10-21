import {
  DEFAULT_CHAT_TITLE,
  deriveChatTitle,
  selectChatsToTrim,
} from '../chatHistory';

describe('deriveChatTitle', () => {
  it('normalises whitespace and trims the message', () => {
    expect(deriveChatTitle('  Chicken   rice\nand salad  ')).toBe(
      'Chicken rice and salad'
    );
  });

  it('falls back to the default title for empty input', () => {
    expect(deriveChatTitle(' \n\t ')).toBe(DEFAULT_CHAT_TITLE);
  });

  it('keeps titles at 60 characters or fewer', () => {
    const title = deriveChatTitle('a'.repeat(100));

    expect(title).toHaveLength(60);
    expect(title.endsWith('…')).toBe(true);
  });

  it('does not truncate a 60-character title', () => {
    const content = 'b'.repeat(60);

    expect(deriveChatTitle(content)).toBe(content);
  });
});

describe('selectChatsToTrim', () => {
  const chats = [
    { id: 'oldest', bytes: 100 },
    { id: 'middle', bytes: 200 },
    { id: 'newest', bytes: 300 },
  ];

  it('keeps everything while both limits are satisfied', () => {
    expect(selectChatsToTrim(chats, 'newest', 3, 600, 3, 600)).toEqual([]);
  });

  it('removes the oldest chats when the count limit is exceeded', () => {
    expect(selectChatsToTrim(chats, 'newest', 3, 600, 2, 600)).toEqual([
      'oldest',
    ]);
  });

  it('removes the oldest chats until the byte budget is met', () => {
    expect(selectChatsToTrim(chats, 'newest', 3, 600, 10, 300)).toEqual([
      'oldest',
      'middle',
    ]);
  });

  it('skips the active chat even when it is the oldest', () => {
    expect(selectChatsToTrim(chats, 'oldest', 3, 600, 2, 600)).toEqual([
      'middle',
    ]);
  });

  it('never removes the only active chat to satisfy the byte budget', () => {
    expect(
      selectChatsToTrim(chats.slice(0, 1), 'oldest', 1, 100, 200, 50)
    ).toEqual([]);
  });
});
