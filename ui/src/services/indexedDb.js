const dbPromises = new Map();

function getDbCacheKey(dbName, dbVersion) {
  return `${String(dbName)}::${Number(dbVersion)}`;
}

export function openIndexedDb({ dbName, dbVersion, onUpgradeNeeded }) {
  const key = getDbCacheKey(dbName, dbVersion);
  if (dbPromises.has(key)) return dbPromises.get(key);

  const dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, dbVersion);
    req.onerror = () => {
      dbPromises.delete(key);
      reject(req.error);
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        try {
          db.close();
        } catch {
          // ignore close errors
        }
        dbPromises.delete(key);
      };
      db.onclose = () => {
        dbPromises.delete(key);
      };
      resolve(db);
    };
    req.onupgradeneeded = (event) => {
      if (typeof onUpgradeNeeded === 'function') {
        onUpgradeNeeded(event.target.result);
      }
    };
  });

  dbPromises.set(key, dbPromise);
  return dbPromise;
}

export async function clearObjectStores({ dbName, dbVersion, onUpgradeNeeded, stores }) {
  const db = await openIndexedDb({ dbName, dbVersion, onUpgradeNeeded });
  await new Promise((resolve, reject) => {
    const tx = db.transaction(stores, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to clear stores'));
    stores.forEach((storeName) => {
      tx.objectStore(storeName).clear();
    });
  });
}
