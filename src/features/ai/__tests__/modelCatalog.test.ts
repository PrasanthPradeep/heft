import { parseChatGptModels, parsePlatformModels } from '../modelCatalog';

describe('parseChatGptModels', () => {
  it('keeps listed models in server order and drops hidden ones', () => {
    const body = {
      models: [
        { slug: 'gpt-5', display_name: 'GPT-5', visibility: 'list' },
        { slug: 'internal', display_name: 'Internal', visibility: 'hidden' },
        { slug: 'gpt-5-mini', display_name: 'GPT-5 mini', visibility: 'list' },
      ],
    };
    expect(parseChatGptModels(body)).toEqual([
      { slug: 'gpt-5', displayName: 'GPT-5' },
      { slug: 'gpt-5-mini', displayName: 'GPT-5 mini' },
    ]);
  });

  it('falls back to the slug when display_name is missing', () => {
    const body = { models: [{ slug: 'gpt-5', visibility: 'list' }] };
    expect(parseChatGptModels(body)).toEqual([
      { slug: 'gpt-5', displayName: 'gpt-5' },
    ]);
  });

  it('deduplicates and ignores malformed entries', () => {
    const body = {
      models: [
        { slug: 'gpt-5', visibility: 'list' },
        { slug: 'gpt-5', visibility: 'list' },
        { slug: '', visibility: 'list' },
        null,
        'nope',
      ],
    };
    expect(parseChatGptModels(body)).toEqual([
      { slug: 'gpt-5', displayName: 'gpt-5' },
    ]);
  });

  it('returns an empty list for unexpected bodies', () => {
    expect(parseChatGptModels(null)).toEqual([]);
    expect(parseChatGptModels({ data: [] })).toEqual([]);
    expect(parseChatGptModels('nope')).toEqual([]);
  });
});

describe('parsePlatformModels', () => {
  it('reads ids, hides non-chat models, and sorts', () => {
    const body = {
      object: 'list',
      data: [
        { id: 'gpt-4o' },
        { id: 'text-embedding-3-small' },
        { id: 'gpt-4o-mini' },
        { id: 'whisper-1' },
        { id: 'dall-e-3' },
      ],
    };
    expect(parsePlatformModels(body)).toEqual([
      { slug: 'gpt-4o', displayName: 'gpt-4o' },
      { slug: 'gpt-4o-mini', displayName: 'gpt-4o-mini' },
    ]);
  });

  it('tolerates missing data', () => {
    expect(parsePlatformModels({ models: [] })).toEqual([]);
    expect(parsePlatformModels(undefined)).toEqual([]);
  });
});
