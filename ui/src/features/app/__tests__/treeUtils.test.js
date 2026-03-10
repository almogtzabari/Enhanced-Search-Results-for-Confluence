import { describe, expect, it } from 'vitest';
import { buildTree, collectExpandableNodeIds } from '../utils/treeUtils.js';

describe('treeUtils', () => {
  it('builds ancestor hierarchy from results', () => {
    const results = [{
      id: '10',
      title: 'Child',
      type: 'page',
      _links: { webui: '/pages/10' },
      space: { name: 'Engineering' },
      ancestors: [
        { id: '1', title: 'Root', _links: { webui: '/pages/1' } },
      ],
    }];

    const roots = buildTree(results, 'https://example.atlassian.net/wiki');
    expect(roots).toHaveLength(1);
    expect(roots[0].id).toBe('1');
    expect(roots[0].children[0].id).toBe('10');
  });

  it('collects only expandable node ids', () => {
    const ids = collectExpandableNodeIds([
      { id: '1', children: [{ id: '2', children: [] }] },
      { id: '3', children: [] },
    ]);

    expect(ids).toEqual(['1']);
  });
});
