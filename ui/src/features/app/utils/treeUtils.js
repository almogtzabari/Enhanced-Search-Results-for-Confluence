import { buildConfluenceUrl } from './urlUtils.js';

export function buildTree(results, baseUrl) {
  const nodeMap = new Map();
  const roots = [];

  const ensure = (id, value) => {
    if (!nodeMap.has(id)) {
      nodeMap.set(id, value);
    } else {
      const existing = nodeMap.get(id);
      if (!existing.sourceItem && value.sourceItem) existing.sourceItem = value.sourceItem;
      if ((!existing.url || existing.url === '#') && value.url) existing.url = value.url;
    }
    return nodeMap.get(id);
  };

  results.forEach((item) => {
    (item.ancestors || []).forEach((ancestor, idx, arr) => {
      ensure(ancestor.id, {
        id: ancestor.id,
        title: ancestor.title,
        url: buildConfluenceUrl(baseUrl, ancestor._links?.webui),
        isResult: false,
        type: 'page',
        sourceItem: {
          id: ancestor.id,
          title: ancestor.title,
          type: 'page',
          _links: ancestor._links || {},
          space: item.space || {},
          history: {},
          version: {},
          ancestors: arr.slice(0, idx),
        },
        children: [],
      });
    });

    ensure(item.id, {
      id: item.id,
      title: item.title,
      url: buildConfluenceUrl(baseUrl, item._links?.webui),
      isResult: true,
      type: item.type || 'page',
      sourceItem: item,
      children: [],
    });
  });

  results.forEach((item) => {
    const pageNode = nodeMap.get(item.id);
    if (!pageNode) return;

    const ancestors = item.ancestors || [];
    if (ancestors.length === 0) {
      if (!roots.some((r) => r.id === pageNode.id)) roots.push(pageNode);
      return;
    }

    let parent = null;
    ancestors.forEach((ancestor) => {
      const node = nodeMap.get(ancestor.id);
      if (!node) return;
      if (parent && !parent.children.some((c) => c.id === node.id)) parent.children.push(node);
      parent = node;
    });

    if (parent && !parent.children.some((c) => c.id === pageNode.id)) {
      parent.children.push(pageNode);
    }

    const root = nodeMap.get(ancestors[0].id);
    if (root && !roots.some((r) => r.id === root.id)) roots.push(root);
  });

  return roots;
}

export function collectExpandableNodeIds(nodes) {
  const ids = [];
  const walk = (list) => {
    list.forEach((node) => {
      if (!Array.isArray(node?.children) || node.children.length === 0) return;
      ids.push(node.id);
      walk(node.children);
    });
  };
  walk(nodes);
  return ids;
}
