function toSortableText(value) {
  return String(value || '').trim().toLocaleLowerCase();
}

function toSortableTimestamp(value) {
  const stamp = Date.parse(value || '');
  return Number.isFinite(stamp) ? stamp : null;
}

export function getTableSortValue(item, key) {
  switch (key) {
    case 'type':
      return toSortableText(item.type);
    case 'name':
      return toSortableText(item.title);
    case 'space':
      return toSortableText(item.space?.name || item.space?.key);
    case 'contributor':
      return toSortableText(item.history?.createdBy?.displayName
        || item.history?.createdBy?.username
        || item.history?.createdBy?.userKey
        || item.history?.createdBy?.accountId);
    case 'created':
      return toSortableTimestamp(item.history?.createdDate);
    case 'modified':
      return toSortableTimestamp(item.version?.when);
    default:
      return null;
  }
}
