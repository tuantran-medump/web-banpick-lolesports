// Lấy ván mới từ Leaguepedia (lol.fandom.com, Cargo API) ngay trong trình duyệt.
// Cùng cách làm với scripts/lp_fallback.py, chỉ khác là chạy trên máy người xem.
// Leaguepedia cho gọi từ trình duyệt khi có tham số origin=* (chỉ ở chế độ khách, không đăng nhập).
// Dữ liệu Leaguepedia theo giấy phép CC BY-SA 3.0: web phải ghi nguồn.

import tierConfig from "../scripts/tier_config.json";
import type { Game, Role, Side, TeamSide, Tier } from "./types";
import { ROLES } from "./types";

export const API = "https://lol.fandom.com/api.php";
export const SOURCE = "leaguepedia";
export const PAGE = 500;

const WANT: Record<string, string[]> = {
  ScoreboardGames: ["GameId", "MatchId", "OverviewPage", "Tournament", "Team1", "Team2", "Winner", "WinTeam",
    "DateTime_UTC", "Patch", "Team1Bans", "Team2Bans", "Team1Picks", "Team2Picks", "Team1Players", "Team2Players",
    "N_GameInMatch"],
  PicksAndBansS7: [
    ...[1, 2].flatMap((t) => ["Ban", "Pick"].flatMap((k) => [1, 2, 3, 4, 5].map((i) => `Team${t}${k}${i}`))),
    "Team1PicksByRoleOrder", "Team2PicksByRoleOrder",
  ],
  Tournaments: ["League", "Year", "Split", "IsPlayoffs", "Region"],
  Leagues: ["League_Short"],
};
const ALIAS: Record<string, string> = { ScoreboardGames: "SG", PicksAndBansS7: "PB", Tournaments: "T", Leagues: "L" };

// ---------------------------------------------------------------------------
// Gọi API, chờ khi bị giới hạn tốc độ
// ---------------------------------------------------------------------------

/** Leaguepedia vẫn giới hạn sau khi đã chờ hết thời gian cho phép. */
export class RateLimitError extends Error {}
/** Leaguepedia trả lỗi khác (không phải giới hạn tốc độ): thử lại cũng vô ích. */
export class LeaguepediaError extends Error {}

export interface ApiOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
  /** Tổng thời gian tối đa được chờ cho cả lần cập nhật (ms). */
  budgetMs?: number;
  /** Lần chờ đầu tiên (ms), sau đó gấp đôi. */
  firstWaitMs?: number;
  /** Báo cho giao diện: đang chờ bao lâu và vì sao. */
  onWait?: (ms: number, reason: string) => void;
}

export type Api = (params: Record<string, string | number>) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new DOMException("Đã dừng", "AbortError"));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal!.reason ?? new DOMException("Đã dừng", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

export function makeApi(o: ApiOptions = {}): Api {
  const f = o.fetch ?? fetch.bind(globalThis);
  const nap = o.sleep ?? sleep;
  const budget = o.budgetMs ?? 90_000;
  let waited = 0;
  return async (params) => {
    const q = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), format: "json", origin: "*" });
    let wait = o.firstWaitMs ?? 8_000;
    for (;;) {
      let reason: string;
      let retryAfter: number | null = null;
      try {
        const r = await f(`${API}?${q}`, { signal: o.signal, credentials: "omit" });
        if (r.status === 429 || r.status === 503) {
          reason = "Leaguepedia đang giới hạn tốc độ";
          const ra = Number(r.headers.get("Retry-After"));
          if (ra > 0) retryAfter = ra * 1000;
        } else if (!r.ok) {
          throw new LeaguepediaError(`Leaguepedia trả về lỗi ${r.status}`);
        } else {
          const data = await r.json();
          if (!data.error) return data;
          if (data.error.code !== "ratelimited" && data.error.code !== "maxlag") {
            throw new LeaguepediaError(`Leaguepedia báo lỗi: ${data.error.info || data.error.code}`);
          }
          reason = "Leaguepedia đang giới hạn tốc độ";
        }
      } catch (e) {
        if (isAbort(e) || o.signal?.aborted || e instanceof LeaguepediaError) throw e;
        // Trình duyệt chặn đọc phản hồi lỗi không có header CORS (thường là 429): coi như bị giới hạn.
        reason = "Không kết nối được Leaguepedia";
      }
      const w = Math.min(Math.max(retryAfter ?? wait, 1000), budget - waited);
      if (w <= 0) throw new RateLimitError(`${reason}. Đã chờ ${Math.round(budget / 1000)} giây, dừng lần này.`);
      o.onWait?.(w, reason);
      await nap(w, o.signal);
      waited += w;
      wait *= 2;
    }
  };
}

// ---------------------------------------------------------------------------
// Truy vấn
// ---------------------------------------------------------------------------

const FIELDS_KEY = "lp-fields-v1";
const FIELDS_TTL = 7 * 24 * 3600 * 1000;

/** Danh sách cột của các bảng Cargo, lưu 7 ngày để mỗi lần cập nhật đỡ 4 lượt gọi. */
export async function tableFields(api: Api, pause: () => Promise<void>): Promise<Record<string, string[]>> {
  try {
    const c = JSON.parse(localStorage.getItem(FIELDS_KEY) || "null");
    if (c && Date.now() - c.t < FIELDS_TTL && c.tables?.ScoreboardGames) return c.tables;
  } catch {
    /* không đọc được: hỏi lại */
  }
  const tables: Record<string, string[]> = {};
  for (const t of Object.keys(WANT)) {
    const d = await api({ action: "cargofields", table: t });
    tables[t] = Object.keys(d.cargofields || {});
    await pause();
  }
  try {
    localStorage.setItem(FIELDS_KEY, JSON.stringify({ t: Date.now(), tables }));
  } catch {
    /* bỏ qua */
  }
  return tables;
}

export function buildFields(tables: Record<string, string[]>): { fields: string[]; firstPickCols: string[] } {
  const fields: string[] = [];
  const firstPickCols: string[] = [];
  for (const [table, want] of Object.entries(WANT)) {
    const have = new Set(tables[table] || []);
    const a = ALIAS[table];
    for (const name of want) if (have.has(name)) fields.push(`${a}.${name}=${a}_${name}`);
    // Từ 2026 đội pick đầu có thể ở phe đỏ: lấy cột ghi lượt pick đầu nếu Leaguepedia có.
    if (table === "ScoreboardGames" || table === "PicksAndBansS7") {
      for (const name of [...have].sort()) {
        if (/first_?pick/i.test(name)) {
          fields.push(`${a}.${name}=${a}_${name}`);
          firstPickCols.push(`${a}_${name}`);
        }
      }
    }
  }
  if (!fields.some((f) => f.startsWith("SG.GameId="))) throw new LeaguepediaError("Không đọc được cấu trúc bảng ScoreboardGames");
  return { fields, firstPickCols };
}

export type Row = Record<string, string>;

const normRow = (r: Record<string, unknown>): Row =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [k.replace(/ /g, "_"), v == null ? "" : String(v)]));

/** Lấy từng trang 500 ván có giờ UTC sau `since`, xếp theo thời gian. Gọi onPage sau mỗi trang để lưu dần. */
export async function fetchSince(
  api: Api, fields: string[], since: string, pause: () => Promise<void>, onPage: (rows: Row[]) => Promise<void>,
): Promise<number> {
  let offset = 0;
  for (;;) {
    const d = await api({
      action: "cargoquery",
      tables: "ScoreboardGames=SG,PicksAndBansS7=PB,Tournaments=T,Leagues=L",
      join_on: "SG.GameId=PB.GameId,SG.OverviewPage=T.OverviewPage,T.League=L.League",
      fields: fields.join(","),
      where: `SG.DateTime_UTC > "${since}"`,
      order_by: "SG.DateTime_UTC",
      limit: PAGE,
      offset,
    });
    const rows = (d.cargoquery || []).map((x: { title: Record<string, unknown> }) => normRow(x.title));
    await onPage(rows);
    offset += rows.length;
    if (rows.length < PAGE) return offset;
    await pause();
  }
}

// ---------------------------------------------------------------------------
// Đổi sang định dạng Game (giống oe_convert.py)
// ---------------------------------------------------------------------------

type TierCfg = { default: string; tiers: Record<string, Record<string, string[]>> };
const CFG = tierConfig as unknown as TierCfg;
const TIER_LOOKUP = new Map<string, [Tier, string]>();
for (const [tier, leagues] of Object.entries(CFG.tiers)) {
  for (const [name, codes] of Object.entries(leagues)) for (const c of codes) TIER_LOOKUP.set(c.toLowerCase(), [tier as Tier, name]);
}

export function tierOf(league: string): [Tier, string | null] {
  return TIER_LOOKUP.get((league || "").trim().toLowerCase()) ?? [CFG.default as Tier, null];
}

/** Đổi tên giải của Leaguepedia sang mã của Oracle's Elixir nếu biết. */
export function leagueResolver(knownCodes: Iterable<string>) {
  const lookup = new Map<string, string>();
  for (const c of knownCodes) lookup.set(c.toLowerCase(), c);
  for (const leagues of Object.values(CFG.tiers)) {
    for (const [name, codes] of Object.entries(leagues)) {
      for (const alias of [...codes, name]) if (!lookup.has(alias.toLowerCase())) lookup.set(alias.toLowerCase(), codes[0]);
    }
  }
  return (short?: string, full?: string) => {
    for (const v of [short, full]) if (v && lookup.has(v.trim().toLowerCase())) return lookup.get(v.trim().toLowerCase())!;
    return (short || full || "Unknown").trim();
  };
}

/** Leaguepedia ghi phiên bản theo tên Riot (26.07); dữ liệu dùng số nội bộ (16.07) như Oracle's Elixir. */
export function patchInternal(p?: string): string | null {
  const m = /^(\d+)\.(\d+)/.exec(p || "");
  if (!m) return null;
  let major = Number(m[1]);
  if (major >= 25) major -= 10;
  return `${major}.${m[2].padStart(2, "0")}`;
}

export function patchLabel(p: string | null): string | null {
  const m = /^(\d+)\.(\d+)/.exec(p || "");
  if (!m) return null;
  const major = Number(m[1]);
  return `${major >= 15 ? major + 10 : major}.${m[2].padStart(2, "0")}`;
}

const splitList = (v?: string) => (v ? v.split(",").map((x) => x.trim() || null) : []);
const pad = <T,>(l: (T | null)[], n = 5): (T | null)[] => [...l, ...Array(n).fill(null)].slice(0, n);
const toInt = (v?: string) => {
  const n = parseInt(v || "", 10);
  return Number.isFinite(n) ? n : null;
};

function firstPickSide(r: Row, cols: string[], t1: string, t2: string): Side | null {
  for (const c of cols) {
    const v = (r[c] || "").trim();
    if (!v) continue;
    const low = v.toLowerCase();
    const teamCol = /^(SG|PB)_Team([12])/.exec(c);
    if (teamCol) {
      if (["1", "yes", "true", "y"].includes(low)) return teamCol[2] === "1" ? "blue" : "red";
      continue;
    }
    if (["1", "blue", "team1"].includes(low) || v === t1) return "blue";
    if (["2", "red", "team2"].includes(low) || v === t2) return "red";
  }
  return null;
}

/** 20 lượt theo luật 2026: đội pick đầu (F) cũng ban trước, dù ở phe nào. */
export function draftOrder(F: TeamSide, S: TeamSide, f: Side, s: Side): Game["draft"] {
  const [b, r, p, q] = [F.bans, S.bans, F.picks, S.picks];
  return [
    ["ban", f, b[0]], ["ban", s, r[0]], ["ban", f, b[1]], ["ban", s, r[1]], ["ban", f, b[2]], ["ban", s, r[2]],
    ["pick", f, p[0]], ["pick", s, q[0]], ["pick", s, q[1]], ["pick", f, p[1]], ["pick", f, p[2]], ["pick", s, q[2]],
    ["ban", s, r[3]], ["ban", f, b[3]], ["ban", s, r[4]], ["ban", f, b[4]],
    ["pick", s, q[3]], ["pick", f, p[3]], ["pick", f, p[4]], ["pick", s, q[4]],
  ];
}

export function buildGame(
  r: Row, firstPickCols: string[], resolve: ReturnType<typeof leagueResolver>, leagueYear: Map<string, number>,
): Game | null {
  const t1 = r.SG_Team1, t2 = r.SG_Team2;
  const date = (r.SG_DateTime_UTC || "").slice(0, 19);
  if (!(r.SG_GameId && t1 && t2 && date)) return null;
  const league = resolve(r.L_League_Short, r.T_League);
  const [tier, tierLeague] = tierOf(league);
  const year = leagueYear.get(league) ?? toInt(r.T_Year) ?? Number(date.slice(0, 4));
  const hasPb = [1, 2, 3, 4, 5].some((i) => r[`PB_Team1Pick${i}`]);
  const sides = {} as Record<Side, TeamSide>;
  for (const [n, side] of [[1, "blue"], [2, "red"]] as const) {
    const bans = hasPb ? [1, 2, 3, 4, 5].map((i) => r[`PB_Team${n}Ban${i}`] || null) : pad(splitList(r[`SG_Team${n}Bans`]));
    const picks = hasPb ? [1, 2, 3, 4, 5].map((i) => r[`PB_Team${n}Pick${i}`] || null) : pad(splitList(r[`SG_Team${n}Picks`]));
    const byRoleRaw = splitList(r[`PB_Team${n}PicksByRoleOrder`]);
    const byRole = pad(byRoleRaw.length ? byRoleRaw : splitList(r[`SG_Team${n}Picks`]));
    const players = pad(splitList(r[`SG_Team${n}Players`]));
    const team = n === 1 ? t1 : t2;
    sides[side] = {
      team,
      win: r.SG_Winner === String(n) || r.SG_WinTeam === team,
      bans: bans.map((b) => (b === "None" || b === "Loss of Ban" ? null : b)),
      picks,
      roles: Object.fromEntries(ROLES.map((role, i) => [role, { champion: byRole[i], player: players[i] }])) as Record<
        Role, { champion: string | null; player: string | null }
      >,
    };
  }
  const winner: Side | null = sides.blue.win ? "blue" : sides.red.win ? "red" : null;
  const fp = firstPickSide(r, firstPickCols, t1, t2);
  const first: Side = fp || "blue";
  const second: Side = first === "blue" ? "red" : "blue";
  const patch = patchInternal(r.SG_Patch);
  const matchId = r.SG_MatchId || r.SG_GameId;
  return {
    id: "LP_" + r.SG_GameId,
    league,
    tier,
    tierLeague,
    year,
    split: r.T_Split || null,
    playoffs: ["1", "yes", "true"].includes((r.T_IsPlayoffs || "").toLowerCase()),
    date,
    patch,
    patchLabel: patchLabel(patch),
    gameInSeries: toInt(r.SG_N_GameInMatch),
    complete: true,
    picksOrdered: hasPb,
    winner,
    firstPickSide: fp,
    blue: sides.blue,
    red: sides.red,
    draft: draftOrder(sides[first], sides[second], first, second),
    seriesId: "lp|" + matchId,
    fearlessUsed: [],
    source: SOURCE,
    matchId,
  };
}

/** Gắn lại fearlessUsed cho mọi ván theo series (một trận của Leaguepedia = một series). */
export function assignSeries(games: Game[]): Game[] {
  const groups = new Map<string, Game[]>();
  for (const g of games) {
    const k = g.seriesId;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(g);
  }
  for (const gs of groups.values()) {
    gs.sort((a, b) => (a.gameInSeries ?? 0) - (b.gameInSeries ?? 0) || a.date.localeCompare(b.date));
    const used = new Set<string>();
    for (const g of gs) {
      g.fearlessUsed = [...used].sort();
      for (const s of [g.blue, g.red]) for (const c of s.picks) if (c) used.add(c);
    }
  }
  return games;
}
