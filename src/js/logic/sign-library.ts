// Signature and stamp pictures the user chose to keep, for the Sign tool's
// saved-signature list. PDF.js keeps typed and drawn signatures itself, as
// outlines; pictures stay pictures, so they live here, in IndexedDB.

const DB_NAME = 'cit-sign-images';
const STORE = 'images';
// The list is a handful of signatures and seals, not an image library.
export const MAX_SAVED_SIGN_IMAGES = 10;

export interface SavedSignImage {
  id: string;
  name: string;
  png: Uint8Array;
  width: number;
  height: number;
  at: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(
  mode: 'readonly' | 'readwrite',
  work: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = work(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Saved pictures, oldest first (the order PDF.js lists its own). */
export async function listSavedSignImages(): Promise<SavedSignImage[]> {
  const all = await run('readonly', (store) => store.getAll());
  return (all as SavedSignImage[]).sort((a, b) => a.at - b.at);
}

/** Keeps a picture; false when the list is already full. */
export async function saveSignImage(
  name: string,
  image: { png: Uint8Array; width: number; height: number }
): Promise<boolean> {
  const saved = await listSavedSignImages();
  if (saved.length >= MAX_SAVED_SIGN_IMAGES) return false;
  const item: SavedSignImage = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    png: image.png,
    width: image.width,
    height: image.height,
    at: Date.now(),
  };
  await run('readwrite', (store) => store.put(item));
  return true;
}

export async function deleteSavedSignImage(id: string): Promise<void> {
  await run('readwrite', (store) => store.delete(id));
}
