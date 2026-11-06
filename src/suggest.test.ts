import { describe, expect, it } from "vitest";
import { act, newSeries, nextGame, type Series } from "./draft";
import { DEFAULT_FILTERS, type Filters } from "./filters";
import { assignRoles, buildModel, smoothedWr, suggestNext, suggestStep } from "./suggest";
import type { Game, Side, TeamSide } from "./types";

const ROLES = ["top", "jng", "mid", "bot", "sup"] as const;
function side(team: string, win: boolean, picks: string[], bans: string[]): TeamSide {
  return {
    team, win, picks, bans,
    roles: Object.fromEntries(ROLES.map((r, i) => [r, { champion: picks[i], player: null }])) as TeamSide["roles"],
  };
}
let id = 0;
function game(blue: TeamSide, red: TeamSide, o: Partial<Game> = {}): Game {
  const winner: Side = blue.win ? "blue" : "red";
  const draft: Game["draft"] = [];
  for (let i = 0; i < 5; i++) draft.push(["ban", "blue", blue.bans[i]], ["ban", "red", red.bans[i]]);
  for (let i = 0; i < 5; i++) draft.push(["pick", "blue", blue.picks[i]], ["pick", "red", red.picks[i]]);
  return {
    id: String(id++), league: "LCK", tier: "1", tierLeague: "LCK", year: 2026, split: null, playoffs: false,
    date: "2026-05-01 10:00:00", patch: "16.08", patchLabel: "26.08", gameInSeries: 1, complete: true,
    picksOrdered: true, winner, firstPickSide: "blue", seriesId: `s${id}`, fearlessUsed: [], draft, blue, red, ...o,
  };
}

const BANS = ["B1", "B2", "B3", "B4", "B5"];
// Azir (mid) có mặt mọi ván và thắng nhiều; Ahri (mid) ít xuất hiện.
const games: Game[] = [];
for (let i = 0; i < 12; i++) {
  games.push(game(
    side("T1", i % 4 !== 0, ["Gnar", "Vi", "Azir", "Varus", "Rell"], BANS),
    side("GEN", i % 4 === 0, ["Jax", "Sejuani", "Orianna", "Ezreal", "Leona"], BANS),
  ));
}
games.push(game(side("T1", false, ["Gnar", "Vi", "Ahri", "Varus", "Rell"], BANS),
  side("GEN", true, ["Jax", "Sejuani", "Orianna", "Ezreal", "Leona"], BANS), { tier: "2", patchLabel: "26.01" }));

const POOL = ["Ahri", "Azir", "Gnar", "Vi", "Varus", "Rell", "Jax", "Sejuani", "Orianna", "Ezreal", "Leona", "Teemo"];
const all = { ...DEFAULT_FILTERS, tiers: ["1", "1.5", "2"] as Filters["tiers"] };

describe("buildModel", () => {
  it("giảm trọng số tier 2 và phiên bản cũ", () => {
    const m = buildModel(games, all);
    const ahri = m.champs.get("ahri")!;
    expect(ahri.rawPresence).toBe(1);
    expect(ahri.presence).toBeCloseTo(0.45 * 0.8, 5);
    expect(m.champs.get("azir")!.presence).toBe(12);
  });

  it("làm mượt tỉ lệ thắng về 50%", () => {
    expect(smoothedWr({ picks: 0, wins: 0 })).toBe(0.5);
    expect(smoothedWr({ picks: 2, wins: 2 })).toBeCloseTo(7 / 12);
  });

  it("gán vai trò theo dữ liệu", () => {
    const m = buildModel(games, all);
    const r = assignRoles(m, ["Rell", "Azir"]);
    expect(r.get("rell")).toBe("sup");
    expect(r.get("azir")).toBe("mid");
  });
});

describe("gợi ý", () => {
  it("ưu tiên tướng presence cao và bỏ tướng đã dùng", () => {
    const m = buildModel(games, DEFAULT_FILTERS);
    let s: Series = newSeries();
    const first = suggestStep(m, s, POOL)!;
    expect(first.step.kind).toBe("ban");
    expect(first.items.map((x) => x.champion)).not.toContain("Teemo"); // không có dữ liệu
    s = act(s, first.items[0].champion);
    const again = suggestStep(m, s, POOL)!;
    expect(again.items.map((x) => x.champion)).not.toContain(first.items[0].champion);
  });

  it("không gợi ý tướng trùng vai trò đã đủ", () => {
    const m = buildModel(games, DEFAULT_FILTERS);
    let s: Series = newSeries();
    for (let i = 0; i < 6; i++) s = act(s, null); // bỏ 6 lượt cấm
    s = act(s, "Azir"); // đội pick trước lấy mid
    s = act(s, "Gnar");
    s = act(s, "Vi");
    const st = suggestStep(m, s, POOL, 20)!; // đội pick trước chọn tiếp
    const orianna = st.items.find((x) => x.champion === "Orianna")!;
    const varus = st.items.find((x) => x.champion === "Varus")!;
    expect(varus.score).toBeGreaterThan(orianna.score);
    expect(orianna.reasons.some((r) => r.text.includes("vai trò") && r.points < 0)).toBe(true);
  });

  it("trả về lượt hiện tại và lượt kế tiếp, giả định chọn gợi ý đầu", () => {
    const m = buildModel(games, DEFAULT_FILTERS);
    const out = suggestNext(m, newSeries(), POOL);
    expect(out).toHaveLength(2);
    expect(out[1].index).toBe(1);
    expect(out[1].assumed).toBe(out[0].items[0].champion);
    expect(out[1].items.map((x) => x.champion)).not.toContain(out[1].assumed);
  });

  it("Fearless: không gợi ý tướng đã pick ở ván trước", () => {
    const m = buildModel(games, all);
    let s: Series = newSeries();
    for (const c of ["B1", "B2", "B3", "B4", "B5", "B6", "Azir", "Gnar", "Vi", "Varus", "Rell", "Jax",
      "B7", "B8", "B9", "B10", "Sejuani", "Orianna", "Ezreal", "Leona"]) s = act(s, c);
    s = nextGame(s);
    const st = suggestStep(m, s, POOL, 20)!;
    expect(st.items.map((x) => x.champion)).toEqual(["Ahri"]);
  });
});
