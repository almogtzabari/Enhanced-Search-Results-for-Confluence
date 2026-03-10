import { describe, expect, it } from 'vitest';
import {
  buildSearchSignature,
  cqlFromState,
  dedupeByKey,
} from '../utils/searchUtils.js';

describe('searchUtils', () => {
  it('builds deterministic search signature', () => {
    const signature = buildSearchSignature({
      baseUrl: 'https://example.atlassian.net/wiki',
      searchText: 'alpha',
      filterType: 'page',
      filterDate: '1w',
      filterSpace: 'ENG',
      filterContributor: 'u1',
      resultsPerRequest: 75,
    });
    expect(signature).toBe('https://example.atlassian.net/wiki|alpha|page|1w|ENG|u1|75');
  });

  it('deduplicates by key while preserving first item order', () => {
    const result = dedupeByKey([
      { id: 'a', name: 'A1' },
      { id: 'a', name: 'A2' },
      { id: 'b', name: 'B1' },
    ], 'id');

    expect(result).toEqual([
      { id: 'a', name: 'A1' },
      { id: 'b', name: 'B1' },
    ]);
  });

  it('creates cql with escaped text and filters', () => {
    const encoded = cqlFromState('hello "world"', 'page', 'any', 'ENG', 'u1');
    const decoded = decodeURIComponent(encoded);

    expect(decoded).toContain('text ~ "hello \\"world\\""');
    expect(decoded).toContain('space="ENG"');
    expect(decoded).toContain('creator="u1"');
    expect(decoded).toContain('type="page"');
  });
});
