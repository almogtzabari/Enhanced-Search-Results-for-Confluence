import { describe, expect, it } from 'vitest';
import { getTableSortValue } from '../utils/tableUtils.js';

describe('tableUtils', () => {
  it('extracts sortable text values', () => {
    const item = { title: 'My Page', type: 'page', space: { name: 'Engineering' }, history: { createdBy: { displayName: 'Alice' } } };

    expect(getTableSortValue(item, 'name')).toBe('my page');
    expect(getTableSortValue(item, 'type')).toBe('page');
    expect(getTableSortValue(item, 'space')).toBe('engineering');
    expect(getTableSortValue(item, 'contributor')).toBe('alice');
  });

  it('extracts timestamps and handles invalid dates', () => {
    const item = {
      history: { createdDate: '2025-01-01T00:00:00Z' },
      version: { when: 'invalid-date' },
    };

    expect(typeof getTableSortValue(item, 'created')).toBe('number');
    expect(getTableSortValue(item, 'modified')).toBeNull();
  });
});
