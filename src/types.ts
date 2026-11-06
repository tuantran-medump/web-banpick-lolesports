// Kiểu dữ liệu khớp với JSON do scripts/oe_convert.py ghi ra trong public/data/.

export type Side = "blue" | "red";
export type Tier = "1" | "1.5" | "2";
export const TIERS: Tier[] = ["1", "1.5", "2"];
export type Role = "top" | "jng" | "mid" | "bot" | "sup";
export const ROLES: Role[] = ["top", "jng", "mid", "bot", "sup"];

export interface TeamSide {
  team: string | null;
  win: boolean;
  bans: (string | null)[];
  picks: (string | null)[];
  roles: Record<Role, { champion: string | null; player: string | null }>;
}

export interface Game {
  id: string;
  league: string;
  tier: Tier;
  tierLeague: string | null;
  year: number | null;
  split: string | null;
  playoffs: boolean;
  date: string; // "YYYY-MM-DD HH:MM:SS"
  patch: string | null;
  patchLabel: string | null; // "26.07"
  gameInSeries: number | null;
  complete: boolean;
  picksOrdered: boolean;
  winner: Side | null;
  firstPickSide: Side | null;
  blue: TeamSide;
  red: TeamSide;
  draft: ["ban" | "pick", Side, string | null][];
  seriesId: string;
  fearlessUsed: string[];
  source?: string;
}

export interface LeagueEntry {
  league: string;
  year: number;
  tier: Tier;
  file: string;
  games: number;
  series: number;
  leaguepediaGames?: number;
  firstDate: string;
  lastDate: string;
  maxGameInSeries: number;
  patches: Record<string, number>;
}

export interface PatchEntry {
  patch: string;
  internal: string;
  games: number;
  tier1Games: number;
  firstDate: string;
  lastDate: string;
}

export interface DataIndex {
  source: string;
  patches: PatchEntry[];
  leagues: LeagueEntry[];
}

export interface Meta {
  source: string;
  updated: string;
}
