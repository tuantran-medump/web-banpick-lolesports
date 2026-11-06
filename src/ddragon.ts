// Ảnh tướng từ Data Dragon của Riot. Tên tướng của Oracle's Elixir ("Kai'Sa", "Wukong")
// được khớp với tên hoặc mã của Data Dragon ("Kaisa", "MonkeyKing") sau khi bỏ ký tự đặc biệt.

const CDN = "https://ddragon.leagueoflegends.com";
const KEY = "ddragon-v1";
const DAY = 24 * 60 * 60 * 1000;

export interface DDragon {
  version: string;
  ids: Record<string, string>; // tên đã chuẩn hóa -> mã Data Dragon
}

export const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");

// Phòng khi Data Dragon chưa có hoặc đặt tên khác.
const ALIASES: Record<string, string> = { wukong: "MonkeyKing", nunu: "Nunu", renata: "Renata" };

function readCache(): DDragon | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as DDragon & { at: number };
    return Date.now() - c.at < DAY ? c : null;
  } catch {
    return null;
  }
}

export async function loadDDragon(): Promise<DDragon | null> {
  const cached = readCache();
  if (cached) return cached;
  try {
    const versions: string[] = await (await fetch(`${CDN}/api/versions.json`)).json();
    const version = versions[0];
    const data = await (await fetch(`${CDN}/cdn/${version}/data/en_US/champion.json`)).json();
    const ids: Record<string, string> = {};
    for (const [id, c] of Object.entries<{ name: string }>(data.data)) {
      ids[norm(id)] = id;
      ids[norm(c.name)] = id;
    }
    const dd = { version, ids };
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...dd, at: Date.now() }));
    } catch {
      /* trình duyệt chặn lưu: bỏ qua */
    }
    return dd;
  } catch {
    return null;
  }
}

export function champIcon(dd: DDragon | null, champion: string): string | null {
  if (!dd) return null;
  const k = norm(champion);
  const id = dd.ids[k] || ALIASES[k];
  return id ? `${CDN}/cdn/${dd.version}/img/champion/${id}.png` : null;
}
