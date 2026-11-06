// Logic bàn draft mô phỏng: thứ tự 20 lượt năm 2026 và chế độ Fearless.
// Luật 2026: đội được pick trước cũng ban trước, dù đội đó ở phe nào.

import { norm } from "./ddragon";
import type { Side } from "./types";

export type Turn = "F" | "S"; // F = đội pick trước, S = đội pick sau
export interface Step {
  kind: "ban" | "pick";
  turn: Turn;
  phase: 1 | 2;
}

const steps = (kind: Step["kind"], phase: Step["phase"], turns: string): Step[] =>
  turns.split("").map((t) => ({ kind, phase, turn: t as Turn }));

/** 20 lượt: Ban 1 F,S,F,S,F,S · Pick 1 F,S,S,F,F,S · Ban 2 S,F,S,F · Pick 2 S,F,F,S. */
export const DRAFT_ORDER: Step[] = [
  ...steps("ban", 1, "FSFSFS"),
  ...steps("pick", 1, "FSSFFS"),
  ...steps("ban", 2, "SFSF"),
  ...steps("pick", 2, "SFFS"),
];

export type TeamIdx = 0 | 1;

export interface DraftGame {
  blueTeam: TeamIdx; // đội nào ở phe xanh
  firstTeam: TeamIdx; // đội nào được pick trước (và ban trước)
  actions: (string | null)[]; // mỗi lượt đã đi: tên tướng, null = bỏ lượt cấm
}

export interface Series {
  teams: [string, string];
  fearless: boolean;
  bestOf: 1 | 3 | 5;
  games: DraftGame[]; // ván cuối là ván đang draft
}

export const newGame = (prev?: DraftGame): DraftGame =>
  prev
    ? { blueTeam: prev.blueTeam, firstTeam: prev.firstTeam, actions: [] }
    : { blueTeam: 0, firstTeam: 0, actions: [] };

export const newSeries = (old?: Partial<Series>): Series => ({
  teams: old?.teams || ["Đội 1", "Đội 2"],
  fearless: old?.fearless ?? true,
  bestOf: old?.bestOf || 5,
  games: [newGame()],
});

export const sideOf = (g: DraftGame, team: TeamIdx): Side => (g.blueTeam === team ? "blue" : "red");
export const teamOf = (g: DraftGame, turn: Turn): TeamIdx => (turn === "F" ? g.firstTeam : ((1 - g.firstTeam) as TeamIdx));
export const sideOfTurn = (g: DraftGame, turn: Turn): Side => sideOf(g, teamOf(g, turn));
export const isDone = (g: DraftGame) => g.actions.length >= DRAFT_ORDER.length;
export const currentStep = (g: DraftGame): Step | null => DRAFT_ORDER[g.actions.length] || null;

export interface Slots {
  bans: (string | null | undefined)[]; // 5 ô; undefined = chưa tới lượt, null = bỏ lượt
  picks: (string | undefined)[]; // 5 ô
  banSteps: number[]; // chỉ số lượt của từng ô
  pickSteps: number[];
}

/** Các ô ban/pick của một phe theo thứ tự lượt. */
export function slotsOf(g: DraftGame, side: Side): Slots {
  const s: Slots = { bans: [], picks: [], banSteps: [], pickSteps: [] };
  DRAFT_ORDER.forEach((st, i) => {
    if (sideOfTurn(g, st.turn) !== side) return;
    const v = i < g.actions.length ? g.actions[i] : undefined;
    if (st.kind === "ban") {
      s.bans.push(v);
      s.banSteps.push(i);
    } else {
      s.picks.push(v ?? undefined);
      s.pickSteps.push(i);
    }
  });
  return s;
}

/** Tướng đã pick ở các ván trước trong series (Fearless: cả hai đội đều không pick lại được). */
export function fearlessLocked(series: Series): Map<string, number> {
  const m = new Map<string, number>();
  if (!series.fearless) return m;
  series.games.slice(0, -1).forEach((g, gi) => {
    g.actions.forEach((c, i) => {
      if (c && DRAFT_ORDER[i].kind === "pick" && !m.has(norm(c))) m.set(norm(c), gi + 1);
    });
  });
  return m;
}

/** Tướng đã ban hoặc pick trong ván đang draft. */
export function usedInGame(g: DraftGame): Set<string> {
  return new Set(g.actions.filter((c): c is string => !!c).map(norm));
}

export type Availability = { ok: true } | { ok: false; reason: "used" | "fearless"; game?: number };

export function availability(series: Series, champion: string): Availability {
  const g = series.games[series.games.length - 1];
  const k = norm(champion);
  if (usedInGame(g).has(k)) return { ok: false, reason: "used" };
  const game = fearlessLocked(series).get(k);
  if (game) return { ok: false, reason: "fearless", game };
  return { ok: true };
}

const mapLast = (s: Series, f: (g: DraftGame) => DraftGame): Series => ({
  ...s,
  games: [...s.games.slice(0, -1), f(s.games[s.games.length - 1])],
});

/** Chọn tướng cho lượt hiện tại. Trả về series cũ nếu không hợp lệ. */
export function act(series: Series, champion: string | null): Series {
  const g = series.games[series.games.length - 1];
  const st = currentStep(g);
  if (!st) return series;
  if (champion === null && st.kind !== "ban") return series;
  if (champion !== null && !availability(series, champion).ok) return series;
  return mapLast(series, (x) => ({ ...x, actions: [...x.actions, champion] }));
}

export const undo = (series: Series): Series => {
  const g = series.games[series.games.length - 1];
  if (g.actions.length) return mapLast(series, (x) => ({ ...x, actions: x.actions.slice(0, -1) }));
  // Ván mới chưa đi lượt nào: quay lại ván trước.
  if (series.games.length > 1) return { ...series, games: series.games.slice(0, -1) };
  return series;
};

export const resetGame = (series: Series): Series => mapLast(series, (x) => ({ ...x, actions: [] }));

/** Đổi phe hoặc quyền pick trước, chỉ khi ván chưa đi lượt nào. */
export function setup(series: Series, patch: Partial<Pick<DraftGame, "blueTeam" | "firstTeam">>): Series {
  const g = series.games[series.games.length - 1];
  if (g.actions.length) return series;
  return mapLast(series, (x) => ({ ...x, ...patch }));
}

export const canNextGame = (s: Series) => isDone(s.games[s.games.length - 1]) && s.games.length < s.bestOf;

export function nextGame(series: Series): Series {
  if (!canNextGame(series)) return series;
  return { ...series, games: [...series.games, newGame(series.games[series.games.length - 1])] };
}

/** Đọc series đã lưu, bỏ qua dữ liệu hỏng. */
export function parseSeries(raw: string | null): Series | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Series;
    const okGame = (g: DraftGame) =>
      (g.blueTeam === 0 || g.blueTeam === 1) && (g.firstTeam === 0 || g.firstTeam === 1) &&
      Array.isArray(g.actions) && g.actions.length <= DRAFT_ORDER.length &&
      g.actions.every((c) => c === null || typeof c === "string");
    if (!Array.isArray(s.teams) || s.teams.length !== 2 || !Array.isArray(s.games) || !s.games.length) return null;
    if (![1, 3, 5].includes(s.bestOf) || s.games.length > s.bestOf || !s.games.every(okGame)) return null;
    return { teams: [String(s.teams[0]), String(s.teams[1])], fearless: !!s.fearless, bestOf: s.bestOf, games: s.games };
  } catch {
    return null;
  }
}
