// Gộp các ván lấy bằng nút "Cập nhật" (IndexedDB) vào dữ liệu có sẵn của web (public/data).

import {
  assignSeries, buildFields, buildGame, fetchSince, leagueResolver, makeApi, sleep, tableFields, type ApiOptions, type Row,
} from "./leaguepedia";
import { CSV_SOURCE } from "./oe";
import type { DataIndex, Game, LeagueEntry, PatchEntry } from "./types";

const slug = (s: string) => (s || "unknown").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";

/** Ván mới nhất của từng giải trong dữ liệu có sẵn. */
export function lastByLeague(index: DataIndex): Map<string, string> {
  const m = new Map<string, string>();
  for (const l of index.leagues) if (l.lastDate > (m.get(l.league) || "")) m.set(l.league, l.lastDate);
  return m;
}

export interface Merged {
  index: DataIndex;
  /** Ván trong trình duyệt theo file giải (cùng tên file với public/data nếu giải đó đã có). */
  byFile: Map<string, Game[]>;
  /** Ván trong trình duyệt mà dữ liệu có sẵn đã có (web được cập nhật sau đó): xóa được. */
  stale: string[];
}

/**
 * Chỉ giữ ván mới hơn ván cuối cùng của giải đó trong dữ liệu có sẵn, rồi thêm vào index.
 * Ván từ CSV nạp tay (Oracle's Elixir) thay cho ván Leaguepedia cùng khoảng thời gian.
 */
export function mergeLocal(snapshot: DataIndex, local: Game[]): Merged {
  const last = lastByLeague(snapshot);
  const csvLast = new Map<string, string>();
  for (const g of local) {
    if (g.source === CSV_SOURCE && g.date > (last.get(g.league) || "") && g.date > (csvLast.get(g.league) || "")) {
      csvLast.set(g.league, g.date);
    }
  }
  const fileOf = new Map(snapshot.leagues.map((l) => [`${l.year}|${l.league}`, l.file]));
  const byFile = new Map<string, Game[]>();
  const stale: string[] = [];
  for (const g of local) {
    let l = last.get(g.league) || "";
    const c = csvLast.get(g.league) || "";
    if (g.source !== CSV_SOURCE && c > l) l = c;
    if (l && g.date <= l) {
      stale.push(g.id);
      continue;
    }
    const file = fileOf.get(`${g.year}|${g.league}`) || `${g.year}/${slug(g.league)}.json`;
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file)!.push(g);
  }
  if (!byFile.size) return { index: snapshot, byFile, stale };

  const leagues = new Map<string, LeagueEntry>(snapshot.leagues.map((l) => [l.file, l]));
  for (const [file, gs] of byFile) {
    const old = leagues.get(file);
    const e: LeagueEntry = old
      ? { ...old, patches: { ...old.patches } }
      : {
          league: gs[0].league, year: gs[0].year ?? Number(gs[0].date.slice(0, 4)), tier: gs[0].tier, file,
          games: 0, series: 0, firstDate: gs[0].date, lastDate: gs[0].date, maxGameInSeries: 0, patches: {},
        };
    e.games += gs.length;
    e.series += new Set(gs.map((g) => g.seriesId)).size;
    e.localGames = gs.length;
    for (const g of gs) {
      if (g.date < e.firstDate) e.firstDate = g.date;
      if (g.date > e.lastDate) e.lastDate = g.date;
      e.maxGameInSeries = Math.max(e.maxGameInSeries, g.gameInSeries ?? 0);
      if (g.patchLabel) e.patches[g.patchLabel] = (e.patches[g.patchLabel] || 0) + 1;
    }
    leagues.set(file, e);
  }

  const patches = new Map<string, PatchEntry>(snapshot.patches.map((p) => [p.patch, { ...p }]));
  for (const gs of byFile.values()) {
    for (const g of gs) {
      if (!g.patchLabel) continue;
      const p = patches.get(g.patchLabel) || {
        patch: g.patchLabel, internal: g.patch || "", games: 0, tier1Games: 0, firstDate: g.date, lastDate: g.date,
      };
      p.games += 1;
      if (g.tier === "1") p.tier1Games += 1;
      if (g.date < p.firstDate) p.firstDate = g.date;
      if (g.date > p.lastDate) p.lastDate = g.date;
      patches.set(p.patch, p);
    }
  }
  const pk = (s: string) => s.split(".").map(Number).reduce((a, b) => a * 100 + b, 0);
  return {
    index: {
      ...snapshot,
      leagues: [...leagues.values()],
      patches: [...patches.values()].sort((a, b) => pk(b.patch) - pk(a.patch)),
    },
    byFile,
    stale,
  };
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Lấy từ đâu: lùi 3 ngày so với ván mới nhất đang có (để không sót ván ghi muộn), chưa có gì thì 14 ngày gần nhất. */
export function sinceFor(snapshot: DataIndex | null, local: Game[], now = new Date()): string {
  let newest = "";
  for (const l of snapshot?.leagues || []) if (l.lastDate > newest) newest = l.lastDate;
  for (const g of local) if (g.date > newest) newest = g.date;
  const base = newest ? new Date(newest.slice(0, 10) + "T00:00:00Z") : now;
  base.setUTCDate(base.getUTCDate() - (newest ? 3 : 14));
  return `${day(base)} 00:00:00`;
}

export type UpdateStatus =
  | { kind: "fetching"; fetched: number; added: number }
  | { kind: "waiting"; until: number; reason: string; fetched: number; added: number };

export interface UpdateResult {
  added: number; // ván mới chưa có
  fetched: number; // số dòng Leaguepedia trả về
  local: Game[]; // toàn bộ ván trong trình duyệt sau khi cập nhật
}

export interface UpdateDeps extends ApiOptions {
  save: (games: Game[]) => Promise<void>;
  onStatus?: (s: UpdateStatus) => void;
  pauseMs?: number;
}

/**
 * Lấy ván mới từ Leaguepedia và lưu dần sau từng trang. Bị giới hạn tốc độ quá lâu thì ném lỗi,
 * nhưng các trang đã lấy được vẫn được lưu: lần sau bấm Cập nhật sẽ lấy tiếp từ chỗ đó.
 */
export async function runUpdate(snapshot: DataIndex, local: Game[], deps: UpdateDeps): Promise<UpdateResult> {
  const last = lastByLeague(snapshot);
  const since = sinceFor(snapshot, local);
  let fetched = 0;
  let added = 0;
  const all = new Map(local.map((g) => [g.id, g]));
  const api = makeApi({
    ...deps,
    onWait: (ms, reason) => {
      deps.onWait?.(ms, reason);
      deps.onStatus?.({ kind: "waiting", until: Date.now() + ms, reason, fetched, added });
    },
  });
  const nap = deps.sleep ?? sleep;
  const pause = () => nap(deps.pauseMs ?? 1500, deps.signal);

  deps.onStatus?.({ kind: "fetching", fetched, added });
  const { fields, firstPickCols } = buildFields(await tableFields(api, pause));
  const resolve = leagueResolver(last.keys());
  const leagueYear = new Map<string, number>();
  for (const l of snapshot.leagues) {
    if (l.lastDate === last.get(l.league)) leagueYear.set(l.league, l.year);
  }

  await fetchSince(api, fields, since, pause, async (rows: Row[]) => {
    fetched += rows.length;
    const touched = new Set<string>();
    for (const r of rows) {
      const g = buildGame(r, firstPickCols, resolve, leagueYear);
      // Bỏ ván dữ liệu có sẵn đã có (theo ngày của từng giải).
      if (!g || g.date <= (last.get(g.league) || since)) continue;
      if (!all.has(g.id)) added += 1;
      all.set(g.id, g);
      touched.add(g.seriesId);
    }
    if (touched.size) {
      // Tính lại Fearless cho các series vừa có thêm ván (series có thể nằm ở hai trang).
      const changed = [...all.values()].filter((g) => touched.has(g.seriesId));
      assignSeries(changed);
      await deps.save(changed);
    }
    deps.onStatus?.({ kind: "fetching", fetched, added });
  });
  return { added, fetched, local: [...all.values()] };
}

/** Ván trong CSV mà dữ liệu của web chưa có (mới hơn ván cuối cùng của từng giải). */
export function newerThanSnapshot(snapshot: DataIndex | null, games: Game[]): Game[] {
  const last = snapshot ? lastByLeague(snapshot) : new Map<string, string>();
  return games.filter((g) => g.date > (last.get(g.league) || ""));
}

/** Đếm ván trong trình duyệt theo nguồn. */
export function countBySource(merged: Merged | null): { lp: number; csv: number } {
  const n = { lp: 0, csv: 0 };
  for (const gs of merged?.byFile.values() || []) for (const g of gs) n[g.source === CSV_SOURCE ? "csv" : "lp"]++;
  return n;
}
