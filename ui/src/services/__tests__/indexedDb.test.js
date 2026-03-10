import { beforeEach, describe, expect, it, vi } from 'vitest';

function createOpenMock() {
  const controllers = [];
  const open = vi.fn(() => {
    const req = {
      error: null,
      result: null,
      onerror: null,
      onsuccess: null,
      onupgradeneeded: null,
    };
    controllers.push({
      req,
      triggerUpgrade(db) {
        req.onupgradeneeded?.({ target: { result: db } });
      },
      triggerSuccess(db) {
        req.result = db;
        req.onsuccess?.();
      },
      triggerError(error) {
        req.error = error;
        req.onerror?.();
      },
    });
    return req;
  });
  return { open, controllers };
}

async function loadIndexedDbModule() {
  vi.resetModules();
  return import('../indexedDb.js');
}

describe('indexedDb service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete global.indexedDB;
  });

  it('caches open promise by db name + version', async () => {
    const { open, controllers } = createOpenMock();
    global.indexedDB = { open };
    const { openIndexedDb } = await loadIndexedDbModule();
    const db = { close: vi.fn() };

    const p1 = openIndexedDb({ dbName: 'X', dbVersion: 1 });
    const p2 = openIndexedDb({ dbName: 'X', dbVersion: 1 });

    expect(open).toHaveBeenCalledTimes(1);
    expect(p1).toBe(p2);

    controllers[0].triggerSuccess(db);
    await expect(p1).resolves.toBe(db);
  });

  it('invokes onUpgradeNeeded during upgrade events', async () => {
    const { open, controllers } = createOpenMock();
    global.indexedDB = { open };
    const { openIndexedDb } = await loadIndexedDbModule();
    const db = { close: vi.fn() };
    const onUpgradeNeeded = vi.fn();

    const promise = openIndexedDb({
      dbName: 'UpgradeDb',
      dbVersion: 3,
      onUpgradeNeeded,
    });

    controllers[0].triggerUpgrade(db);
    controllers[0].triggerSuccess(db);

    await promise;
    expect(onUpgradeNeeded).toHaveBeenCalledWith(db);
  });

  it('clears failed open promise cache after open error', async () => {
    const { open, controllers } = createOpenMock();
    global.indexedDB = { open };
    const { openIndexedDb } = await loadIndexedDbModule();
    const error = new Error('open failed');

    const first = openIndexedDb({ dbName: 'ErrDb', dbVersion: 1 });
    controllers[0].triggerError(error);
    await expect(first).rejects.toThrow('open failed');

    const second = openIndexedDb({ dbName: 'ErrDb', dbVersion: 1 });
    expect(open).toHaveBeenCalledTimes(2);
    const db2 = { close: vi.fn() };
    controllers[1].triggerSuccess(db2);
    await expect(second).resolves.toBe(db2);
  });

  it('removes cached promise on versionchange and onclose', async () => {
    const { open, controllers } = createOpenMock();
    global.indexedDB = { open };
    const { openIndexedDb } = await loadIndexedDbModule();

    const db = { close: vi.fn() };
    const first = openIndexedDb({ dbName: 'LifecycleDb', dbVersion: 5 });
    controllers[0].triggerSuccess(db);
    await first;

    db.onversionchange?.();
    expect(db.close).toHaveBeenCalledTimes(1);

    const second = openIndexedDb({ dbName: 'LifecycleDb', dbVersion: 5 });
    expect(open).toHaveBeenCalledTimes(2);
    const dbSecond = { close: vi.fn() };
    controllers[1].triggerSuccess(dbSecond);
    await second;

    dbSecond.onclose?.();
    const third = openIndexedDb({ dbName: 'LifecycleDb', dbVersion: 5 });
    expect(open).toHaveBeenCalledTimes(3);
    controllers[2].triggerSuccess({ close: vi.fn() });
    await third;
  });

  it('clearObjectStores clears each requested store and resolves on complete', async () => {
    const { open, controllers } = createOpenMock();
    global.indexedDB = { open };
    const { clearObjectStores } = await loadIndexedDbModule();

    const clearA = vi.fn();
    const clearB = vi.fn();
    const tx = {
      oncomplete: null,
      onerror: null,
      error: null,
      objectStore: vi.fn((name) => {
        if (name === 'a') return { clear: clearA };
        if (name === 'b') return { clear: clearB };
        return { clear: vi.fn() };
      }),
    };
    const db = {
      close: vi.fn(),
      transaction: vi.fn(() => {
        queueMicrotask(() => tx.oncomplete?.());
        return tx;
      }),
    };

    const promise = clearObjectStores({
      dbName: 'ClrDb',
      dbVersion: 1,
      stores: ['a', 'b'],
    });
    controllers[0].triggerSuccess(db);
    await promise;

    expect(db.transaction).toHaveBeenCalledWith(['a', 'b'], 'readwrite');
    expect(clearA).toHaveBeenCalledTimes(1);
    expect(clearB).toHaveBeenCalledTimes(1);
  });

  it('clearObjectStores rejects when transaction fails', async () => {
    const { open, controllers } = createOpenMock();
    global.indexedDB = { open };
    const { clearObjectStores } = await loadIndexedDbModule();

    const tx = {
      oncomplete: null,
      onerror: null,
      error: null,
      objectStore: vi.fn(() => ({ clear: vi.fn() })),
    };
    const db = {
      close: vi.fn(),
      transaction: vi.fn(() => {
        queueMicrotask(() => tx.onerror?.());
        return tx;
      }),
    };

    const promise = clearObjectStores({
      dbName: 'FailDb',
      dbVersion: 1,
      stores: ['a'],
    });
    controllers[0].triggerSuccess(db);

    await expect(promise).rejects.toThrow('Failed to clear stores');
  });
});
