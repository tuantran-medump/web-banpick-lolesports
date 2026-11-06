import type { Filters } from "./filters";
import { ROLES, type Game, type Role, type Side } from "./types";

const other = (s: Side): Side => (s === "blue" ? "red" : "blue");

/** Lọc game theo mọi tiêu chí trừ đội và phe (hai tiêu chí này đổi góc nhìn, xem sidesOf). */
export function matchGame(g: Game, f: Filters): boolean {
  if (!f.tiers.includes(g.tier)) return false;
  if (f.leagues.length && !f.leagues.includes(g.league)) return false;
  const day = (g.date || "").slice(0, 10);
  if (f.from && day < f.from) return false;
  if (f.to && day > f.to) return false;
  if (f.patches.length && !(g.patchLabel && f.patches.includes(g.patchLabel))) return false;
  if (f.games.length && !(g.gameInSeries && f.games.includes(g.gameInSeries))) return false;
  if (f.stage === "playoffs" && !g.playoffs) return false;
  if (f.stage === "regular" && g.playoffs) return false;
  return true;
}

/** Phe nào của game được tính theo bộ lọc đội/phe. Rỗng = bỏ game. */
export function sidesOf(g: Game, f: Filters): Side[] {
  const first: Side = g.firstPickSide || "blue";
  let sides: Side[] = ["blue", "red"];
  if (f.side === "blue" || f.side === "red") sides = [f.side];
  else if (f.side === "first") sides = [first];
  else if (f.side === "second") sides = [other(first)];
  if (f.team) sides = sides.filter((s) => g[s].team === f.team);
  return sides;
}

/** Có bộ lọc đội hoặc phe thì thống kê theo góc nhìn một đội/phe mỗi game. */
export const isPerspective = (f: Filters) => f.side !== "all" || f.team !== "";

export interface ChampStat {
  champion: string;
  presence: number; // số game được pick hoặc ban
  picks: number;
  wins: number;
  bans: number;
  bannedAgainst: number; // chỉ có ở góc nhìn đội/phe: đối thủ cấm tướng này
  bluePicks: number;
  redPicks: number;
  firstPicks: number; // lượt pick đầu tiên của game
  roles: Partial<Record<Role, number>>;
}

export interface Summary {
  games: number; // số mẫu: số game, hoặc số lượt đội/phe ở góc nhìn đội/phe
  series: number;
  blueWins: number;
  decided: number; // game có kết quả
  wins: number; // góc nhìn đội/phe: số trận thắng
  champions: ChampStat[];
  perspective: boolean;
}

function blank(champion: string): ChampStat {
  return { champion, presence: 0, picks: 0, wins: 0, bans: 0, bannedAgainst: 0,
    bluePicks: 0, redPicks: 0, firstPicks: 0, roles: {} };
}

export function computeStats(games: Game[], f: Filters): Summary {
  const perspective = isPerspective(f);
  const map = new Map<string, ChampStat>();
  const get = (c: string) => {
    let s = map.get(c);
    if (!s) map.set(c, (s = blank(c)));
    return s;
  };
  const series = new Set<string>();
  let n = 0, blueWins = 0, decided = 0, wins = 0;

  for (const g of games) {
    if (!matchGame(g, f)) continue;
    const sides = sidesOf(g, f);
    if (!sides.length) continue;
    series.add(g.seriesId);
    if (g.winner) decided++;
    if (g.winner === "blue") blueWins++;

    const roleOf = (s: Side) => {
      const m = new Map<string, Role>();
      for (const r of ROLES) {
        const c = g[s].roles?.[r]?.champion;
        if (c) m.set(c, r);
      }
      return m;
    };
    const firstPick = g.draft?.find((d) => d[0] === "pick")?.[2] || null;

    // Cả game: mỗi game là một mẫu, tính cả hai phe. Góc nhìn: mỗi phe được chọn là một mẫu.
    const units: Side[][] = perspective ? sides.map((s) => [s]) : [["blue", "red"]];
    for (const unit of units) {
      n++;
      const seen = new Set<string>();
      for (const s of unit) {
        const t = g[s];
        if (perspective && g.winner === s) wins++;
        const roles = roleOf(s);
        for (const c of t.picks) {
          if (!c) continue;
          const st = get(c);
          st.picks++;
          if (t.win) st.wins++;
          if (s === "blue") st.bluePicks++;
          else st.redPicks++;
          if (c === firstPick) st.firstPicks++;
          const r = roles.get(c);
          if (r) st.roles[r] = (st.roles[r] || 0) + 1;
          seen.add(c);
        }
        for (const c of t.bans) {
          if (!c) continue;
          get(c).bans++;
          seen.add(c);
        }
        if (perspective) {
          for (const c of g[other(s)].bans) if (c) get(c).bannedAgainst++;
        }
      }
      for (const c of seen) get(c).presence++;
    }
  }

  return { games: n, series: series.size, blueWins, decided, wins, perspective,
    champions: [...map.values()] };
}

export function mainRole(s: ChampStat): Role | null {
  let best: Role | null = null;
  for (const r of ROLES) if ((s.roles[r] || 0) > (best ? s.roles[best] || 0 : 0)) best = r;
  return best;
}

/** Các vai trò tướng từng đi với tỉ lệ ≥ min (mặc định 15%), xếp giảm dần. Tướng đa vai trò có nhiều dòng. */
export function rolesOf(s: ChampStat, min = 0.15): { role: Role; share: number }[] {
  const tot = ROLES.reduce((a, r) => a + (s.roles[r] || 0), 0);
  if (!tot) return [];
  return ROLES.map((role) => ({ role, share: (s.roles[role] || 0) / tot }))
    .filter((x) => x.share >= min)
    .sort((a, b) => b.share - a.share);
}

/** Danh sách đội (kèm số game) trong các game khớp bộ lọc, không tính bộ lọc đội. */
export function teamsOf(games: Game[], f: Filters): { team: string; games: number }[] {
  const c = new Map<string, number>();
  const g2 = { ...f, team: "" };
  for (const g of games) {
    if (!matchGame(g, g2)) continue;
    for (const s of sidesOf(g, g2)) {
      const t = g[s].team;
      if (t) c.set(t, (c.get(t) || 0) + 1);
    }
  }
  return [...c].map(([team, games]) => ({ team, games })).sort((a, b) => b.games - a.games || a.team.localeCompare(b.team));
}
