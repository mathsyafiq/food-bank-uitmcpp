// Device storage in IndexedDB: the pantry device key, the cached catalogue and photos, and the
// offline visit queue (CLAUDE.md section 9). Falls back to memory if IndexedDB is unavailable.

const NAME = 'foodbank';
const VERSION = 1;
let dbPromise = null;
let memory = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(NAME, VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos');
        if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'visit_id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('IndexedDB blocked'));
    }).catch(() => {
      memory = { kv: new Map(), photos: new Map(), queue: new Map() };
      return null;
    });
  }
  return dbPromise;
}

/** True when data survives closing the page (IndexedDB works). */
export async function isPersistent() {
  return (await open()) !== null;
}

async function run(storeName, mode, action) {
  const db = await open();
  if (!db) return action(null);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = action(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(request ? request.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

export async function get(storeName, key) {
  const value = await run(storeName, 'readonly', (s) => (s ? s.get(key) : null));
  return memory ? memory[storeName].get(key) : value;
}

export async function set(storeName, key, value) {
  if (await open()) return run(storeName, 'readwrite', (s) => s.put(value, key));
  memory[storeName].set(key, value);
}

export async function remove(storeName, key) {
  if (await open()) return run(storeName, 'readwrite', (s) => s.delete(key));
  memory[storeName].delete(key);
}

/** Storage for core/queue.js. */
export const queueStorage = {
  async getAll() {
    if (await open()) return run('queue', 'readonly', (s) => s.getAll());
    return Array.from(memory.queue.values());
  },
  async put(entry) {
    if (await open()) return run('queue', 'readwrite', (s) => s.put(entry));
    memory.queue.set(entry.visit_id, entry);
  },
  async remove(visitId) {
    if (await open()) return run('queue', 'readwrite', (s) => s.delete(visitId));
    memory.queue.delete(visitId);
  },
};

/** Asks the browser not to clear this site's storage under pressure. Pantry devices only. */
export async function askToPersist() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch (err) {
    // Not supported: nothing to do.
  }
  return false;
}
