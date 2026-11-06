// Kho IndexedDB trong trình duyệt: các ván lấy bằng nút "Cập nhật".
// Dữ liệu chỉ nằm trên máy này, không gửi đi đâu.

import type { Game } from "./types";

const DB = "banpick-local";
const STORE = "games";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

export async function getLocalGames(): Promise<Game[]> {
  if (typeof indexedDB === "undefined") return [];
  try {
    return (await tx<Game[]>("readonly", (s) => s.getAll() as IDBRequest<Game[]>)) ?? [];
  } catch {
    return [];
  }
}

export async function putLocalGames(games: Game[]): Promise<void> {
  if (!games.length) return;
  await tx("readwrite", (s) => {
    for (const g of games) s.put(g);
  });
}

export async function deleteLocalGames(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await tx("readwrite", (s) => {
    for (const id of ids) s.delete(id);
  });
}

export async function clearLocalGames(): Promise<void> {
  await tx("readwrite", (s) => s.clear());
}
