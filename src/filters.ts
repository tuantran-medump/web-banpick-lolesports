import { TIERS, type DataIndex, type LeagueEntry, type Tier } from "./types";

/** Góc nhìn phe: tất cả, phe xanh/đỏ, hay đội pick trước/pick sau (luật First Selection 2026). */
export type SideFilter = "all" | "blue" | "red" | "first" | "second";
export type StageFilter = "all" | "regular" | "playoffs";

export interface Filters {
  tiers: Tier[];
  leagues: string[]; // rỗng = mọi giải thuộc tier đã chọn
  from: string; // "YYYY-MM-DD", rỗng = không giới hạn
  to: string;
  patches: string[]; // nhãn Riot "26.07"; rỗng = mọi phiên bản
  games: number[]; // ván 1..5 trong series; rỗng = mọi ván
  side: SideFilter;
  team: string; // rỗng = mọi đội
  stage: StageFilter;
}

export const DEFAULT_FILTERS: Filters = {
  tiers: ["1"],
  leagues: [],
  from: "",
  to: "",
  patches: [],
  games: [],
  side: "all",
  team: "",
  stage: "all",
};

const SIDES: SideFilter[] = ["all", "blue", "red", "first", "second"];
const STAGES: StageFilter[] = ["all", "regular", "playoffs"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Lưu bộ lọc trên URL (sau dấu #) để gửi link cho người khác. */
export function filtersToHash(f: Filters): string {
  const p = new URLSearchParams();
  if (f.tiers.join() !== DEFAULT_FILTERS.tiers.join()) p.set("tier", f.tiers.join(","));
  if (f.leagues.length) p.set("league", f.leagues.join(","));
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (f.patches.length) p.set("patch", f.patches.join(","));
  if (f.games.length) p.set("game", f.games.join(","));
  if (f.side !== "all") p.set("side", f.side);
  if (f.team) p.set("team", f.team);
  if (f.stage !== "all") p.set("stage", f.stage);
  return p.toString();
}

export function filtersFromHash(hash: string): Filters {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const list = (k: string) => (p.get(k) || "").split(",").map((s) => s.trim()).filter(Boolean);
  const tiers = list("tier").filter((t): t is Tier => (TIERS as string[]).includes(t));
  const side = p.get("side") as SideFilter;
  const stage = p.get("stage") as StageFilter;
  const from = p.get("from") || "";
  const to = p.get("to") || "";
  return {
    tiers: p.has("tier") ? tiers : DEFAULT_FILTERS.tiers,
    leagues: list("league"),
    from: DATE.test(from) ? from : "",
    to: DATE.test(to) ? to : "",
    patches: list("patch").filter((s) => /^\d+\.\d+$/.test(s)),
    games: list("game").map(Number).filter((n) => n >= 1 && n <= 5),
    side: SIDES.includes(side) ? side : "all",
    team: p.get("team") || "",
    stage: STAGES.includes(stage) ? stage : "all",
  };
}

/** Tên hiển thị của giải: dùng tên trong tier_config (WLDs -> Worlds), còn lại giữ mã của Oracle's Elixir. */
export const LEAGUE_NAMES: Record<string, string> = {
  WLDs: "Worlds",
  FST: "First Stand",
  DCup: "Demacia Cup",
  LCKC: "LCK CL",
};
export const leagueName = (code: string) => LEAGUE_NAMES[code] || code;

/** Các file giải cần tải cho bộ lọc hiện tại (chỉ dựa vào index.json, chưa cần tải game). */
export function filesFor(index: DataIndex, f: Filters): LeagueEntry[] {
  return index.leagues.filter(
    (l) =>
      f.tiers.includes(l.tier) &&
      (f.leagues.length === 0 || f.leagues.includes(l.league)) &&
      (!f.from || l.lastDate.slice(0, 10) >= f.from) &&
      (!f.to || l.firstDate.slice(0, 10) <= f.to),
  );
}

export function patchKey(label: string): number {
  const [a, b] = label.split(".").map(Number);
  return a * 100 + b;
}
