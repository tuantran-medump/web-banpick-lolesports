import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS, filesFor, filtersFromHash, filtersToHash, type Filters } from "./filters";
import { computeStats, teamsOf } from "./stats";
import type { DataIndex, Game, Side, TeamSide } from "./types";

function side(team: string, win: boolean, picks: string[], bans: string[]): TeamSide {
  const roles = ["top", "jng", "mid", "bot", "sup"] as const;
  return {
    team, win, picks, bans,
    roles: Object.fromEntries(roles.map((r, i) => [r, { champion: picks[i], player: null }])) as TeamSide["roles"],
  };
}

function game(o: Partial<Game> & { blue: TeamSide; red: TeamSide }): Game {
  const winner: Side = o.blue.win ? "blue" : "red";
  const first: Side = o.firstPickSide || "blue";
  return {
    id: Math.random().toString(36), league: "LCK", tier: "1", tierLeague: "LCK", year: 2026, split: null,
    playoffs: false, date: "2026-05-01 10:00:00", patch: "16.08", patchLabel: "26.08", gameInSeries: 1,
    complete: true, picksOrdered: true, winner, firstPickSide: first, seriesId: "s1", fearlessUsed: [],
    draft: [["ban", first, null], ["pick", first, o[first].picks[0]]],
    ...o,
  };
}

const g1 = game({
  blue: side("T1", true, ["Azir", "Vi", "Rumble", "Varus", "Nautilus"], ["Orianna", "Jayce", "Ryze", "Bard", "Ahri"]),
  red: side("GEN", false, ["Orianna", "Jarvan IV", "Gnar", "Kai'Sa", "Rell"], ["Azir", "Corki", "Yone", "Vayne", "Sion"]),
});
const g2 = game({
  gameInSeries: 2, firstPickSide: "red", patchLabel: "26.09", date: "2026-05-02 10:00:00", seriesId: "s2",
  blue: side("GEN", false, ["Azir", "Sejuani", "Ksante", "Ezreal", "Leona"], ["Vi", "Jayce", "Ryze", "Bard", "Ahri"]),
  red: side("T1", true, ["Orianna", "Viego", "Gragas", "Varus", "Rakan"], ["Rumble", "Corki", "Yone", "Vayne", "Sion"]),
});
const F = (o: Partial<Filters> = {}): Filters => ({ ...DEFAULT_FILTERS, ...o });
const champ = (s: ReturnType<typeof computeStats>, c: string) => s.champions.find((x) => x.champion === c)!;

describe("computeStats", () => {
  it("tính theo cả ván khi không lọc đội/phe", () => {
    const s = computeStats([g1, g2], F());
    expect(s.games).toBe(2);
    expect(s.series).toBe(2);
    expect(s.blueWins).toBe(1);
    const azir = champ(s, "Azir");
    expect(azir.picks).toBe(2);
    expect(azir.wins).toBe(1);
    expect(azir.bans).toBe(1);
    expect(azir.presence).toBe(2); // pick + ban cùng ván chỉ tính một lần
    expect(azir.firstPicks).toBe(1);
    expect(champ(s, "Orianna").firstPicks).toBe(1); // ván 2 phe đỏ pick trước
    expect(champ(s, "Varus").roles.bot).toBe(2);
  });

  it("lọc phiên bản và ván", () => {
    expect(computeStats([g1, g2], F({ patches: ["26.09"] })).games).toBe(1);
    expect(computeStats([g1, g2], F({ games: [1] })).games).toBe(1);
    expect(computeStats([g1, g2], F({ to: "2026-05-01" })).games).toBe(1);
    expect(computeStats([g1, g2], F({ tiers: ["2"] })).games).toBe(0);
  });

  it("góc nhìn đội: chỉ đếm pick/ban của đội đó, đếm cả tướng bị đối thủ cấm", () => {
    const s = computeStats([g1, g2], F({ team: "T1" }));
    expect(s.perspective).toBe(true);
    expect(s.games).toBe(2);
    expect(s.wins).toBe(2);
    expect(champ(s, "Varus").picks).toBe(2);
    expect(champ(s, "Azir").picks).toBe(1);
    expect(champ(s, "Azir").bannedAgainst).toBe(1);
    expect(champ(s, "Vi").bannedAgainst).toBe(1);
    expect(s.champions.find((c) => c.champion === "Sejuani")).toBeUndefined();
  });

  it("góc nhìn phe: pick trước / phe đỏ", () => {
    const first = computeStats([g1, g2], F({ side: "first" }));
    expect(first.games).toBe(2);
    expect(first.wins).toBe(2); // T1 pick trước cả hai ván
    const red = computeStats([g1, g2], F({ side: "red" }));
    expect(champ(red, "Orianna").picks).toBe(2);
    expect(champ(red, "Orianna").redPicks).toBe(2);
    expect(computeStats([g1, g2], F({ side: "blue", team: "T1" })).games).toBe(1);
  });

  it("danh sách đội", () => {
    expect(teamsOf([g1, g2], F()).map((t) => t.team).sort()).toEqual(["GEN", "T1"]);
  });
});

describe("filters", () => {
  it("lưu và đọc lại từ URL", () => {
    const f = F({ tiers: ["1", "1.5"], leagues: ["LCK"], from: "2026-01-01", patches: ["26.08"], games: [1, 2], side: "first", team: "T1", stage: "playoffs" });
    expect(filtersFromHash("#" + filtersToHash(f))).toEqual(f);
    expect(filtersFromHash("")).toEqual(DEFAULT_FILTERS);
    expect(filtersFromHash("#side=xx&game=9&from=abc").side).toBe("all");
  });

  it("chọn file theo tier, giải và khoảng ngày", () => {
    const idx: DataIndex = {
      source: "", patches: [],
      leagues: [
        { league: "LCK", year: 2026, tier: "1", file: "2026/LCK.json", games: 1, series: 1, firstDate: "2026-01-10", lastDate: "2026-09-01", maxGameInSeries: 5, patches: {} },
        { league: "LCS", year: 2027, tier: "1.5", file: "2027/LCS.json", games: 1, series: 1, firstDate: "2026-10-01", lastDate: "2026-10-20", maxGameInSeries: 3, patches: {} },
      ],
    };
    expect(filesFor(idx, F()).map((l) => l.file)).toEqual(["2026/LCK.json"]);
    expect(filesFor(idx, F({ tiers: ["1", "1.5"], from: "2026-09-15" })).map((l) => l.file)).toEqual(["2027/LCS.json"]);
  });
});
