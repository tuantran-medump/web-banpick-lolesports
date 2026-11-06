import type { DataIndex, Game, Meta } from "./types";

const BASE = `${import.meta.env.BASE_URL}data/`;

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(BASE + path, { cache: "no-cache" });
  if (!r.ok) throw new Error(`Không tải được ${path} (${r.status})`);
  return r.json() as Promise<T>;
}

export const loadIndex = () => getJson<DataIndex>("index.json");

export async function loadMeta(): Promise<Meta | null> {
  try {
    return await getJson<Meta>("meta.json");
  } catch {
    return null;
  }
}

// Mỗi file giải chỉ tải một lần trong phiên.
const cache = new Map<string, Promise<Game[]>>();

export function loadLeagueFile(file: string): Promise<Game[]> {
  let p = cache.get(file);
  if (!p) {
    p = getJson<{ games: Game[] }>(file).then((d) => d.games);
    p.catch(() => cache.delete(file));
    cache.set(file, p);
  }
  return p;
}
