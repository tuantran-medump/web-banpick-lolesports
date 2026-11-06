// Gợi ý ban/pick cho lượt hiện tại và lượt kế tiếp, dựa trên thống kê các ván khớp bộ lọc.
//
// Điểm của một tướng là tổng các thành phần (đơn vị "điểm"), mỗi thành phần kèm một lý do:
//  - Meta: presence có trọng số theo tier giải và độ mới của phiên bản.
//  - Tỉ lệ thắng làm mượt kiểu Bayes (kéo về 50% khi ít mẫu).
//  - Hợp đồng đội với tướng đã pick, khắc chế/bị khắc chế đối thủ cùng đường.
//  - Linh hoạt nhiều vai trò (giá trị khi pick sớm), thói quen pick ở lượt này và ở ván thứ N.
//  - Vai trò còn trống của đội (pick) hoặc của đối thủ (ban).
// Tướng đã dùng trong ván hoặc bị khóa Fearless không bao giờ được gợi ý.

import { norm } from "./ddragon";
import { act, availability, currentStep, DRAFT_ORDER, sideOfTurn, teamOf, type DraftGame, type Series, type Step, type TeamIdx } from "./draft";
import { patchKey, type Filters } from "./filters";
import { isPerspective, matchGame, sidesOf } from "./stats";
import { ROLES, type Game, type Role, type Side, type Tier } from "./types";

export const TIER_WEIGHT: Record<Tier, number> = { "1": 1, "1.5": 0.7, "2": 0.45 };
/** Mỗi phiên bản cũ hơn bản mới nhất trong dữ liệu đang lọc thì trọng số nhân thêm hệ số này. */
export const PATCH_DECAY = 0.8;
const PRIOR_WR = 10; // số ván ảo 50% khi làm mượt tỉ lệ thắng
const PRIOR_PAIR = 6; // số ván ảo khi làm mượt cặp tướng / đối đầu

const other = (s: Side): Side => (s === "blue" ? "red" : "blue");

interface ChampAgg {
  name: string; // tên theo dữ liệu giải
  presence: number; // trọng số
  picks: number;
  wins: number;
  bans: number;
  rawPicks: number;
  rawPresence: number;
  roles: Partial<Record<Role, number>>;
  pickAt: number[]; // theo thứ tự pick 0..9 trong ván
  banAt: number[]; // theo thứ tự ban 0..9 trong ván
  byGame: number[]; // presence theo ván 1..5 trong series (chỉ số 0..4)
}

interface PairAgg {
  n: number; // trọng số
  wins: number; // trọng số ván thắng (của tướng thứ nhất với đối đầu)
  raw: number;
}

export interface Model {
  units: number; // tổng trọng số mẫu (để tính presence)
  rawUnits: number;
  totalPicks: number;
  totalBans: number;
  pickAt: number[];
  banAt: number[];
  byGame: number[]; // trọng số số mẫu theo ván 1..5
  champs: Map<string, ChampAgg>;
  pairs: Map<string, PairAgg>; // "a|b" (a<b) cùng đội
  lanes: Map<string, PairAgg>; // "role|a|b": a đối đầu b cùng đường, wins là của a
  vs: Map<string, PairAgg>; // "a|b": a gặp b ở đội bên kia (mọi vai trò), wins là của a
  latestPatch: string | null;
}

const zeros = (n: number) => new Array<number>(n).fill(0);

/** Gom thống kê có trọng số từ các ván khớp bộ lọc (giống tab Thống kê: đội/phe đổi góc nhìn). */
export function buildModel(games: Game[], f: Filters): Model {
  const matched = games.filter((g) => matchGame(g, f) && sidesOf(g, f).length);
  const patches = [...new Set(matched.map((g) => g.patchLabel).filter((p): p is string => !!p))]
    .sort((a, b) => patchKey(b) - patchKey(a));
  const rank = new Map(patches.map((p, i) => [p, i]));
  const perspective = isPerspective(f);

  const m: Model = {
    units: 0, rawUnits: 0, totalPicks: 0, totalBans: 0, pickAt: zeros(10), banAt: zeros(10), byGame: zeros(5),
    champs: new Map(), pairs: new Map(), lanes: new Map(), vs: new Map(), latestPatch: patches[0] || null,
  };
  const get = (c: string) => {
    const k = norm(c);
    let a = m.champs.get(k);
    if (!a) {
      a = { name: c, presence: 0, picks: 0, wins: 0, bans: 0, rawPicks: 0, rawPresence: 0, roles: {},
        pickAt: zeros(10), banAt: zeros(10), byGame: zeros(5) };
      m.champs.set(k, a);
    }
    return a;
  };
  const addPair = (map: Map<string, PairAgg>, key: string, w: number, win: boolean) => {
    let p = map.get(key);
    if (!p) map.set(key, (p = { n: 0, wins: 0, raw: 0 }));
    p.n += w;
    p.raw++;
    if (win) p.wins += w;
  };

  for (const g of matched) {
    const w = TIER_WEIGHT[g.tier] * PATCH_DECAY ** (rank.get(g.patchLabel || "") ?? patches.length);
    const gi = g.gameInSeries && g.gameInSeries >= 1 && g.gameInSeries <= 5 ? g.gameInSeries - 1 : -1;
    const sides = sidesOf(g, f);

    // Thứ tự pick/ban trong ván (chỉ khi dữ liệu có thứ tự).
    const pickOrd = new Map<string, number>();
    const banOrd = new Map<string, number>();
    if (g.picksOrdered && g.draft?.length) {
      let p = 0, b = 0;
      for (const [kind, s, c] of g.draft) {
        if (kind === "pick") {
          if (c) pickOrd.set(`${s}|${norm(c)}`, p);
          p++;
        } else {
          if (c) banOrd.set(`${s}|${norm(c)}`, b);
          b++;
        }
      }
    }

    const units: Side[][] = perspective ? sides.map((s) => [s]) : [["blue", "red"]];
    for (const unit of units) {
      m.units += w;
      m.rawUnits++;
      if (gi >= 0) m.byGame[gi] += w;
      const seen = new Set<string>();
      for (const s of unit) {
        const t = g[s];
        for (const c of t.picks) {
          if (!c) continue;
          const a = get(c);
          a.picks += w;
          a.rawPicks++;
          if (t.win) a.wins += w;
          m.totalPicks += w;
          const o = pickOrd.get(`${s}|${norm(c)}`);
          if (o !== undefined) {
            a.pickAt[o] += w;
            m.pickAt[o] += w;
          }
          seen.add(norm(c));
        }
        for (const r of ROLES) {
          const c = t.roles?.[r]?.champion;
          if (c) get(c).roles[r] = (get(c).roles[r] || 0) + w;
        }
        for (const c of t.bans) {
          if (!c) continue;
          const a = get(c);
          a.bans += w;
          m.totalBans += w;
          const o = banOrd.get(`${s}|${norm(c)}`);
          if (o !== undefined) {
            a.banAt[o] += w;
            m.banAt[o] += w;
          }
          seen.add(norm(c));
        }
        // Cặp tướng cùng đội.
        const ps = t.picks.filter((c): c is string => !!c).map(norm);
        for (let i = 0; i < ps.length; i++)
          for (let j = i + 1; j < ps.length; j++) addPair(m.pairs, pairKey(ps[i], ps[j]), w, t.win);
        // Đối đầu cùng đường (từ góc nhìn phe này).
        const e = g[other(s)];
        for (const a of ps)
          for (const b of e.picks) if (b) addPair(m.vs, `${a}|${norm(b)}`, w, t.win);
        for (const r of ROLES) {
          const a = t.roles?.[r]?.champion;
          const b = e.roles?.[r]?.champion;
          if (a && b) addPair(m.lanes, `${r}|${norm(a)}|${norm(b)}`, w, t.win);
        }
      }
      for (const k of seen) {
        const a = m.champs.get(k)!;
        a.presence += w;
        a.rawPresence++;
        if (gi >= 0) a.byGame[gi] += w;
      }
    }
  }
  return m;
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Tỉ lệ thắng làm mượt Bayes về 50%. */
export function smoothedWr(a: { picks: number; wins: number } | undefined): number {
  if (!a) return 0.5;
  return (a.wins + PRIOR_WR * 0.5) / (a.picks + PRIOR_WR);
}

/** Tỉ lệ vai trò (đã làm mượt nhẹ). Tướng chưa có dữ liệu: chia đều. */
function roleShare(m: Model, k: string): Record<Role, number> {
  const a = m.champs.get(k);
  const tot = a ? ROLES.reduce((s, r) => s + (a.roles[r] || 0), 0) : 0;
  const out = {} as Record<Role, number>;
  for (const r of ROLES) out[r] = tot ? ((a!.roles[r] || 0) + 0.02) / (tot + 0.1) : 0.2;
  return out;
}

export interface RoleDist {
  /** Xác suất mỗi tướng đã pick đi từng vai trò (tướng đa vai trò chia cho nhiều đường). */
  champs: Map<string, Record<Role, number>>;
  /** Xác suất mỗi vai trò của đội còn trống. */
  open: Record<Role, number>;
}

const zeroRoles = (): Record<Role, number> => ({ top: 0, jng: 0, mid: 0, bot: 0, sup: 0 });

/**
 * Phân bố vai trò của một đội: xét mọi cách xếp các tướng đã pick vào 5 vai trò (không trùng),
 * mỗi cách có trọng số bằng tích tỉ lệ vai trò của từng tướng. Ví dụ đội đã có Gragas (Top/Rừng)
 * và Vi (Rừng) thì Gragas gần như chắc đi Top; nếu chỉ có Gragas thì cả Top lẫn Rừng còn bỏ ngỏ.
 */
export function roleDist(m: Model, picks: string[]): RoleDist {
  const keys = picks.map(norm).slice(0, 5);
  const shares = keys.map((k) => roleShare(m, k));
  const acc = keys.map(zeroRoles);
  let total = 0;
  const used = new Set<Role>();
  const cur: Role[] = [];
  const rec = (i: number, w: number) => {
    if (i === keys.length) {
      total += w;
      cur.forEach((r, j) => (acc[j][r] += w));
      return;
    }
    for (const r of ROLES) {
      if (used.has(r)) continue;
      used.add(r);
      cur.push(r);
      rec(i + 1, w * shares[i][r]);
      cur.pop();
      used.delete(r);
    }
  };
  rec(0, 1);
  const champs = new Map<string, Record<Role, number>>();
  const open = { top: 1, jng: 1, mid: 1, bot: 1, sup: 1 } as Record<Role, number>;
  keys.forEach((k, j) => {
    const d = zeroRoles();
    for (const r of ROLES) {
      d[r] = total ? acc[j][r] / total : 0;
      open[r] -= d[r];
    }
    champs.set(k, d);
  });
  for (const r of ROLES) open[r] = Math.max(0, open[r]);
  return { champs, open };
}

/** Vai trò khả dĩ nhất của từng tướng đã pick (dùng để hiển thị/kiểm thử). */
export function assignRoles(m: Model, picks: string[]): Map<string, Role> {
  const d = roleDist(m, picks);
  return new Map([...d.champs].map(([k, p]) => [k, ROLES.reduce((b, r) => (p[r] > p[b] ? r : b), ROLES[0])]));
}

/** Tướng có thể đi những vai trò nào (tỉ lệ ≥ min), xếp theo tỉ lệ giảm dần. */
export function flexRolesOf(m: Model, champion: string, min = 0.15): { role: Role; share: number }[] {
  const a = m.champs.get(norm(champion));
  if (!a) return [];
  const tot = ROLES.reduce((s, r) => s + (a.roles[r] || 0), 0);
  if (!tot) return [];
  return ROLES.map((role) => ({ role, share: (a.roles[role] || 0) / tot }))
    .filter((x) => x.share >= min)
    .sort((x, y) => y.share - x.share);
}

export interface Reason {
  text: string;
  points: number; // đóng góp vào điểm (dương = tốt cho lựa chọn này)
  info?: boolean; // chỉ để giải thích, không cộng trừ điểm
}

export interface Suggestion {
  champion: string; // tên hiển thị (theo danh sách tướng của bàn draft)
  score: number;
  role: Role | null; // vai trò dự kiến (pick) hoặc vai trò của đối thủ bị chặn (ban)
  roles: { role: Role; p: number }[]; // các vai trò khả dĩ (≥15%), tướng đa vai trò có nhiều dòng
  reasons: Reason[];
  samples: number; // số ván có mặt (chưa trọng số)
}

export interface StepSuggestions {
  index: number; // chỉ số lượt 0..19
  step: Step;
  team: TeamIdx;
  side: Side;
  assumed: string | null; // lượt trước giả định đã chọn tướng này (khi gợi ý cho lượt kế tiếp)
  /** Tướng đã pick chưa chốt đường (đa vai trò), theo đội: dùng để giải thích vai trò còn trống. */
  unsure: { team: TeamIdx; champion: string; roles: { role: Role; p: number }[] }[];
  items: Suggestion[];
}

const ROLE_VI: Record<Role, string> = { top: "Top", jng: "Rừng", mid: "Giữa", bot: "AD", sup: "Hỗ trợ" };
const pct = (x: number) => `${(100 * x).toFixed(0)}%`;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const signed = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(100 * x).toFixed(0)}%`;

interface Ctx {
  m: Model;
  g: DraftGame;
  gameNo: number;
  step: Step;
  index: number;
  side: Side; // phe đang đi lượt
  allies: string[]; // tướng đã pick của đội đang đi lượt
  enemies: string[];
  avail: string[]; // tên chuẩn hóa của các tướng còn chọn được (có trong dữ liệu)
  allyDist: RoleDist;
  enemyDist: RoleDist;
}

function picksOfSide(g: DraftGame, side: Side): string[] {
  const out: string[] = [];
  g.actions.forEach((c, i) => {
    if (c && DRAFT_ORDER[i].kind === "pick" && sideOfTurn(g, DRAFT_ORDER[i].turn) === side) out.push(c);
  });
  return out;
}

/** Lift của tướng ở một vị trí (lượt pick/ban thứ k, ván thứ N) so với trung bình, làm mượt. */
function lift(x: number, champTotal: number, slotTotal: number, allTotal: number): { lift: number; x: number } {
  if (!allTotal || !champTotal) return { lift: 1, x: 0 };
  const expected = (slotTotal * champTotal) / allTotal;
  return { lift: (x + 1) / (expected + 1), x };
}

/** Đánh giá một tướng cho lượt hiện tại của ngữ cảnh. */
function evaluate(ctx: Ctx, champion: string): Suggestion {
  const { m, step } = ctx;
  const k = norm(champion);
  const a = m.champs.get(k);
  const reasons: Reason[] = [];
  const add = (points: number, text: string) => {
    if (Math.abs(points) >= 0.5) reasons.push({ text, points });
  };
  const note = (text: string) => reasons.push({ text, points: 0, info: true });
  let score = 0;
  const plus = (p: number, text: string) => {
    score += p;
    add(p, text);
  };

  // Meta: presence có trọng số.
  const presence = a && m.units ? a.presence / m.units : 0;
  plus(40 * presence, `Presence ${pct(presence)} (${a?.rawPresence || 0} ván)`);

  // Đội được hưởng lợi khi chọn (pick) hoặc đội đối thủ bị chặn (ban).
  const isPick = step.kind === "pick";
  const mine = isPick ? ctx.allies : ctx.enemies; // đội sẽ có tướng này
  const theirs = isPick ? ctx.enemies : ctx.allies;
  const wr = smoothedWr(a);
  if (a && a.rawPicks) plus(100 * (wr - 0.5), `Tỉ lệ thắng ${pct(a.wins / a.picks)} sau làm mượt ${pct(wr)} (${a.rawPicks} lần pick)`);

  // Vai trò: tướng phải lấp được vai trò còn trống của đội sẽ sở hữu nó. Vai trò của các tướng đã pick
  // tính theo xác suất (tướng đa vai trò chưa chốt đường), nên vai trò "còn trống" cũng là xác suất.
  const mineDist = isPick ? ctx.allyDist : ctx.enemyDist;
  const theirDist = isPick ? ctx.enemyDist : ctx.allyDist;
  const share = roleShare(m, k);
  const q = zeroRoles(); // xác suất tướng này sẽ đi từng vai trò nếu vào đội
  let fit = 0;
  for (const r of ROLES) fit += (q[r] = share[r] * mineDist.open[r]);
  for (const r of ROLES) q[r] = fit ? q[r] / fit : 0;
  const role: Role | null = fit ? ROLES.reduce((b, r) => (q[r] > q[b] ? r : b), ROLES[0]) : null;
  if (a && a.rawPicks >= 1) {
    if (fit < 0.15) plus(-30 * (1 - fit / 0.15), isPick ? "Không hợp vai trò đội còn thiếu" : "Đối thủ không còn thiếu vai trò của tướng này");
    else if (mine.length) {
      const likely = ROLES.filter((r) => q[r] >= 0.15).sort((x, y) => q[y] - q[x]);
      const txt = likely.length > 1 ? likely.map((r) => `${ROLE_VI[r]} ${pct(q[r])}`).join(", ") : ROLE_VI[role!];
      note(isPick ? `Vào đội sẽ đi: ${txt}` : `Đối thủ có thể dùng ở: ${txt}`);
    }
  }
  // Linh hoạt nhiều vai trò: giá trị khi pick sớm (giấu bài), ban để bớt rủi ro.
  const flexRoles = flexRolesOf(m, champion).map((x) => x.role);
  if (flexRoles.length >= 2) {
    const early = (isPick ? mine.length : 0) <= 2;
    plus((early ? 4 : 1.5) * (flexRoles.length - 1), `Đa vai trò: ${flexRoles.map((r) => ROLE_VI[r]).join(", ")}`);
  }

  // Hợp với tướng đã pick cùng đội.
  if (a) {
    let syn = 0;
    const notes: string[] = [];
    for (const ally of mine) {
      const ak = norm(ally);
      const p = m.pairs.get(pairKey(k, ak));
      if (!p || p.raw < 3) continue;
      const exp = (wr + smoothedWr(m.champs.get(ak))) / 2;
      const d = (p.wins + PRIOR_PAIR * exp) / (p.n + PRIOR_PAIR) - exp;
      syn += d;
      if (Math.abs(d) >= 0.02) notes.push(`${ally} ${signed(d)} (${p.raw} ván)`);
    }
    if (notes.length) plus(clamp(100 * syn, -10, 10), `Đi cùng ${notes.join(", ")}`);
  }

  // Tỉ lệ thắng khi gặp các tướng đội bên kia đã pick. Phần "cùng đường" tính theo xác suất hai tướng
  // gặp nhau ở cùng một vai trò (tướng đa vai trò được chia cho các đường), phần còn lại tính theo cả trận.
  if (a) {
    let tot = 0;
    const notes: string[] = [];
    for (const opp of theirs) {
      const ok = norm(opp);
      const pe = theirDist.champs.get(ok) || zeroRoles();
      let laneW = 0, laneD = 0, laneRaw = 0;
      for (const r of ROLES) {
        const w = q[r] * pe[r];
        if (w < 0.05) continue;
        const p = m.lanes.get(`${r}|${k}|${ok}`);
        if (!p || p.raw < 3) continue;
        laneW += w;
        laneD += w * ((p.wins + PRIOR_PAIR * wr) / (p.n + PRIOR_PAIR) - wr);
        laneRaw += p.raw;
      }
      const v = m.vs.get(`${k}|${ok}`);
      const dVs = v && v.raw >= 3 ? (v.wins + PRIOR_PAIR * wr) / (v.n + PRIOR_PAIR) - wr : 0;
      const dLane = laneW ? laneD / laneW : 0;
      tot += 1.5 * laneW * dLane + 0.6 * (1 - laneW) * dVs;
      if (laneW >= 0.3 && Math.abs(dLane) >= 0.03)
        notes.push(`${opp} (cùng đường${laneW < 0.8 ? ` ${pct(laneW)}` : ""}) ${signed(dLane)}, ${laneRaw} ván`);
      else if (v && v.raw >= 3 && Math.abs(dVs) >= 0.03) notes.push(`${opp} ${signed(dVs)}, ${v.raw} ván`);
    }
    const pts = clamp(100 * tot, -15, 15);
    score += pts;
    if (notes.length) add(pts, `${isPick ? "Gặp" : "Khi gặp bên mình"}: ${notes.join("; ")}`);
  }

  // Nhìn trước các lượt còn lại (chỉ khi pick): đối thủ còn tướng nào counter được ở các đường tướng này
  // có thể đi, đội mình còn kèo nào đi cùng cho các vai trò còn trống.
  if (isPick && a && role) {
    if (theirs.length < 5) {
      let best: { c: string; d: number; w: number; raw: number; r: Role } | null = null;
      let laneGames = 0;
      for (const r of ROLES) {
        const w = q[r] * theirDist.open[r];
        if (w < 0.1) continue;
        for (const c of ctx.avail) {
          if (c === k) continue;
          const p = m.lanes.get(`${r}|${c}|${k}`);
          if (!p) continue;
          laneGames += p.raw;
          if (p.raw < 3) continue;
          const cw = smoothedWr(m.champs.get(c));
          const d = (p.wins + PRIOR_PAIR * cw) / (p.n + PRIOR_PAIR) - cw;
          if (!best || d * w > best.d * best.w) best = { c, d, w, raw: p.raw, r };
        }
      }
      if (best && best.d >= 0.03)
        plus(-clamp(80 * best.d * best.w, 0, 8),
          `Đối thủ còn counter được: ${m.champs.get(best.c)!.name} (${ROLE_VI[best.r]}) ${signed(best.d)} (${best.raw} ván)`);
      else if (laneGames >= 8) plus(2, "Chưa thấy tướng nào còn lại counter rõ (an toàn khi pick sớm)");
    }
    if (mine.length < 4) {
      const after = roleDist(m, [...mine, champion]).open;
      let best: { c: string; d: number; raw: number } | null = null;
      for (const c of ctx.avail) {
        if (c === k) continue;
        const sh = roleShare(m, c);
        if (ROLES.reduce((x, r) => x + sh[r] * after[r], 0) < 0.15) continue;
        const p = m.pairs.get(pairKey(k, c));
        if (!p || p.raw < 3) continue;
        const exp = (wr + smoothedWr(m.champs.get(c))) / 2;
        const d = (p.wins + PRIOR_PAIR * exp) / (p.n + PRIOR_PAIR) - exp;
        if (!best || d > best.d) best = { c, d, raw: p.raw };
      }
      if (best && best.d >= 0.03)
        plus(clamp(50 * best.d, 0, 6), `Còn kèo đi cùng: ${m.champs.get(best.c)!.name} ${signed(best.d)} (${best.raw} ván)`);
    }
  }

  // Thói quen theo lượt: pick/ban thứ k trong ván.
  if (a) {
    const ord = ctx.g.actions.slice(0, ctx.index).filter((_, i) => DRAFT_ORDER[i].kind === step.kind).length;
    const L = isPick
      ? lift(a.pickAt[ord], a.picks, m.pickAt[ord], m.totalPicks)
      : lift(a.banAt[ord], a.bans, m.banAt[ord], m.totalBans);
    if (L.x >= 1) plus(clamp(3 * Math.log2(L.lift), -5, 6),
      `${isPick ? "Pick" : "Ban"} thứ ${ord + 1} của ván: ${L.lift >= 1 ? "hay" : "ít"} được chọn ở lượt này (×${L.lift.toFixed(1)})`);
  }

  // Thói quen theo ván thứ N của series.
  if (a && ctx.gameNo >= 1 && ctx.gameNo <= 5) {
    const gi = ctx.gameNo - 1;
    const tot = m.byGame.reduce((s, x) => s + x, 0);
    const champTot = a.byGame.reduce((s, x) => s + x, 0);
    const L = lift(a.byGame[gi], champTot, m.byGame[gi], tot);
    if (m.byGame[gi] && tot - m.byGame[gi] > 0 && L.x > 0)
      plus(clamp(3 * Math.log2(L.lift), -5, 5), `Ván ${ctx.gameNo} của series: presence ×${L.lift.toFixed(1)} so với trung bình`);
  }

  // Lý do có điểm xếp trước theo độ lớn, ghi chú giải thích để sau.
  reasons.sort((x, y) => Number(!!x.info) - Number(!!y.info) || Math.abs(y.points) - Math.abs(x.points));
  const roles = ROLES.filter((r) => q[r] >= 0.15).map((r) => ({ role: r, p: q[r] })).sort((x, y) => y.p - x.p);
  return { champion, score, role, roles, reasons, samples: a?.rawPresence || 0 };
}

/** Gợi ý cho lượt hiện tại của ván đang draft (null nếu ván đã xong). */
export function suggestStep(m: Model, series: Series, pool: string[], limit = 5, assumed: string | null = null): StepSuggestions | null {
  const g = series.games[series.games.length - 1];
  const step = currentStep(g);
  if (!step) return null;
  const index = g.actions.length;
  const side = sideOfTurn(g, step.turn);
  const ctx: Ctx = {
    m, g, gameNo: series.games.length, step, index, side,
    allies: picksOfSide(g, side), enemies: picksOfSide(g, other(side)), avail: [],
    allyDist: roleDist(m, []), enemyDist: roleDist(m, []),
  };
  ctx.allyDist = roleDist(m, ctx.allies);
  ctx.enemyDist = roleDist(m, ctx.enemies);
  // Chỉ gợi ý tướng còn chọn được và có xuất hiện trong dữ liệu.
  const cand = pool.filter((c) => availability(series, c).ok && m.champs.get(norm(c))?.rawPresence);
  ctx.avail = cand.map(norm);
  const items = cand
    .map((c) => evaluate(ctx, c))
    .sort((x, y) => y.score - x.score || x.champion.localeCompare(y.champion))
    .slice(0, limit);
  const team = teamOf(g, step.turn);
  const unsure: StepSuggestions["unsure"] = [];
  for (const [t, picks, dist] of [[team, ctx.allies, ctx.allyDist], [(1 - team) as TeamIdx, ctx.enemies, ctx.enemyDist]] as const) {
    for (const c of picks) {
      const d = dist.champs.get(norm(c));
      if (!d || Math.max(...ROLES.map((r) => d[r])) >= 0.8) continue;
      unsure.push({ team: t, champion: c, roles: ROLES.filter((r) => d[r] >= 0.15).map((r) => ({ role: r, p: d[r] })).sort((x, y) => y.p - x.p) });
    }
  }
  return { index, step, team, side, assumed, unsure, items };
}

/** Gợi ý cho lượt hiện tại và lượt kế tiếp (giả định lượt hiện tại chọn gợi ý số 1). */
export function suggestNext(m: Model, series: Series, pool: string[], limit = 5): StepSuggestions[] {
  const first = suggestStep(m, series, pool, limit);
  if (!first) return [];
  const out = [first];
  const top = first.items[0]?.champion;
  if (top) {
    const s2 = act(series, top);
    const second = suggestStep(m, s2, pool, limit, top);
    if (second) out.push(second);
  }
  return out;
}
