// IndexedDB home for open editor buffers. They used to ride along in the
// localStorage tab session, which caps out around 5 MB per site: a few large
// files could silently stop saving, and a reload then lost unsaved edits.
// IndexedDB has no such practical cap and stores the strings as they are.

export type FileBuffer = { content: string; originalContent: string };

const DB_NAME = "netlab.buffers";
const STORE = "fileTabs";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable"));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    request.onblocked = () => reject(new Error("IndexedDB open blocked"));
  });
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

/** Replace everything stored with `buffers`, atomically. Resolves false when it could not be saved. */
export async function saveBuffers(buffers: Record<string, FileBuffer>): Promise<boolean> {
  try {
    const db = await open();
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      store.clear();
      for (const [id, buffer] of Object.entries(buffers)) store.put(buffer, id);
      await finished(tx);
      return true;
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

/** Every stored buffer by tab id; empty when none exist or IndexedDB is unavailable. */
export async function loadBuffers(): Promise<Map<string, FileBuffer>> {
  const result = new Map<string, FileBuffer>();
  try {
    const db = await open();
    try {
      const tx = db.transaction(STORE, "readonly");
      const store = tx.objectStore(STORE);
      const keys = store.getAllKeys();
      const values = store.getAll();
      await finished(tx);
      keys.result.forEach((key, index) => {
        const value = values.result[index] as Partial<FileBuffer> | undefined;
        if (typeof key === "string" && typeof value?.content === "string" && typeof value.originalContent === "string") {
          result.set(key, { content: value.content, originalContent: value.originalContent });
        }
      });
    } finally {
      db.close();
    }
  } catch {
    // fall through to whatever was read
  }
  return result;
}
