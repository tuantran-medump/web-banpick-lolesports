import { describe, expect, it } from "vitest";
import {
  assignSeries, buildFields, buildGame, leagueResolver, LeaguepediaError, makeApi, PAGE, RateLimitError, type Row,
} from "./leaguepedia";
import { mergeLocal, runUpdate, sinceFor } from "./local";
import type { DataIndex, Game } from "./types";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function row(id: string, match: string, n: number, date: string, extra: Partial<Row> = {}): Row {
  const r: Row = {
    SG_GameId: id, SG_MatchId: match, SG_Team1: "T1", SG_Team2: "Gen.G", SG_Winner: "2", SG_DateTime_UTC: date,
    SG_Patch: "26.21", SG_N_GameInMatch: String(n), SG_Team1Players: "a,b,c,d,e", SG_Team2Players: "f,g,h,i,j",
    T_League: "LoL Champions Korea", L_League_Short: "LCK", T_Year: "2026", T_Split: "Playoffs", T_IsPlayoffs: "1",
    PB_Team1PicksByRoleOrder: `K${id},V${id},A${id},J${id},R${id}`, PB_Team2PicksByRoleOrder: `G${id},L${id},S${id},X${id},N${id}`,
    ...extra,
  };
  for (let i = 1; i <= 5; i++) {
    r[`PB_Team1Ban${i}`] ||= `B1${i}`;
    r[`PB_Team2Ban${i}`] ||= `B2${i}`;
    r[`PB_Team1Pick${i}`] ||= r.PB_Team1PicksByRoleOrder.split(",")[i - 1];
    r[`PB_Team2Pick${i}`] ||= r.PB_Team2PicksByRoleOrder.split(",")[i - 1];
  }
  return r;
}

describe("buildGame", () => {
  const resolve = leagueResolver(["LCK", "WLDs"]);
  it("đổi một dòng Leaguepedia sang Game, đội pick đầu ở phe đỏ ban trước", () => {
    const g = buildGame(row("1", "m1", 2, "2026-11-05 10:00:00", { SG_Team2FirstPick: "Yes" }), ["SG_Team2FirstPick"], resolve, new Map())!;
    expect(g.id).toBe("LP_1");
    expect(g.league).toBe("LCK");
    expect(g.tier).toBe("1");
    expect(g.patch).toBe("16.21");
    expect(g.patchLabel).toBe("26.21");
    expect(g.winner).toBe("red");
    expect(g.firstPickSide).toBe("red");
    expect(g.draft[0]).toEqual(["ban", "red", "B21"]);
    expect(g.draft[6]).toEqual(["pick", "red", "G1"]);
    expect(g.blue.roles.mid).toEqual({ champion: "A1", player: "c" });
    expect(g.playoffs).toBe(true);
  });

  it("đổi tên giải dài sang mã của Oracle's Elixir", () => {
    const g = buildGame(row("2", "m", 1, "2026-11-05 10:00:00", { L_League_Short: "", T_League: "Worlds" }), [], resolve, new Map())!;
    expect(g.league).toBe("WLDs");
    expect(g.firstPickSide).toBeNull();
    expect(g.draft[0]).toEqual(["ban", "blue", "B11"]);
  });

  it("Fearless: tướng đã pick ở ván trước trong cùng trận", () => {
    const gs = [2, 1].map((n) => buildGame(row(String(n), "m", n, `2026-11-05 1${n}:00:00`), [], resolve, new Map())!);
    assignSeries(gs);
    const g2 = gs.find((g) => g.gameInSeries === 2)!;
    expect(g2.fearlessUsed).toContain("K1");
    expect(g2.fearlessUsed).toContain("N1");
    expect(gs.find((g) => g.gameInSeries === 1)!.fearlessUsed).toEqual([]);
  });

  it("chỉ lấy các cột Leaguepedia có", () => {
    const { fields, firstPickCols } = buildFields({ ScoreboardGames: ["GameId", "Team1", "FirstPick"], PicksAndBansS7: [] });
    expect(fields).toContain("SG.GameId=SG_GameId");
    expect(fields).not.toContain("SG.MatchId=SG_MatchId");
    expect(firstPickCols).toEqual(["SG_FirstPick"]);
  });
});

describe("makeApi: giới hạn tốc độ", () => {
  const waits: number[] = [];
  const nap = async (ms: number) => void waits.push(ms);

  it("chờ rồi thử lại khi Leaguepedia báo ratelimited hoặc 429", async () => {
    waits.length = 0;
    const replies = [
      () => json({ error: { code: "ratelimited", info: "slow down" } }),
      () => new Response("", { status: 429 }),
      () => { throw new TypeError("Failed to fetch"); }, // phản hồi lỗi không có header CORS
      () => json({ ok: 1 }),
    ];
    let i = 0;
    const urls: string[] = [];
    const api = makeApi({ fetch: async (u) => (urls.push(String(u)), replies[i++]()), sleep: nap, firstWaitMs: 1000 });
    expect(await api({ action: "cargoquery" })).toEqual({ ok: 1 });
    expect(waits).toEqual([1000, 2000, 4000]);
    expect(urls[0]).toContain("origin=*");
  });

  it("hết thời gian chờ thì báo RateLimitError", async () => {
    waits.length = 0;
    const api = makeApi({ fetch: async () => json({ error: { code: "ratelimited" } }), sleep: nap, firstWaitMs: 1000, budgetMs: 5000 });
    await expect(api({})).rejects.toBeInstanceOf(RateLimitError);
    expect(waits.reduce((a, b) => a + b, 0)).toBe(5000);
  });

  it("lỗi khác thì dừng ngay, không thử lại", async () => {
    waits.length = 0;
    const api = makeApi({ fetch: async () => json({ error: { code: "badparams", info: "sai" } }), sleep: nap });
    await expect(api({})).rejects.toBeInstanceOf(LeaguepediaError);
    expect(waits).toEqual([]);
  });
});

const snapshot = (lastDate: string): DataIndex => ({
  source: "test",
  patches: [{ patch: "26.20", internal: "16.20", games: 10, tier1Games: 10, firstDate: "2026-10-01 00:00:00", lastDate }],
  leagues: [{
    league: "LCK", year: 2026, tier: "1", file: "2026/LCK.json", games: 10, series: 4, firstDate: "2026-10-01 00:00:00",
    lastDate, maxGameInSeries: 5, patches: { "26.20": 10 },
  }],
});

describe("runUpdate", () => {
  const tables = {
    ScoreboardGames: ["GameId", "MatchId", "Team1", "Team2", "Winner", "DateTime_UTC", "Patch", "N_GameInMatch", "Team1Players", "Team2Players"],
    PicksAndBansS7: [1, 2].flatMap((t) => ["Ban", "Pick"].flatMap((k) => [1, 2, 3, 4, 5].map((i) => `Team${t}${k}${i}`)))
      .concat(["Team1PicksByRoleOrder", "Team2PicksByRoleOrder"]),
    Tournaments: ["League", "Year", "Split", "IsPlayoffs"],
    Leagues: ["League_Short"],
  };
  const fakeFetch = (pages: (Row[] | "limit")[]) => {
    let page = 0;
    return async (u: RequestInfo | URL) => {
      const p = new URL(String(u)).searchParams;
      if (p.get("action") === "cargofields") {
        return json({ cargofields: Object.fromEntries((tables[p.get("table") as keyof typeof tables] || []).map((n) => [n, {}])) });
      }
      const cur = pages[Math.min(page, pages.length - 1)];
      if (cur === "limit") return json({ error: { code: "ratelimited" } });
      page++;
      return json({ cargoquery: cur.map((title) => ({ title })) });
    };
  };

  it("bỏ ván đã có, lưu ván mới và tính Fearless cho series nằm ở hai trang", async () => {
    // Trang 1 đủ 500 dòng (ván cũ hơn dữ liệu web + ván mới), trang 2 chứa ván 2 của trận m-last.
    const page1: Row[] = [];
    for (let i = 0; i < PAGE - 1; i++) page1.push(row(`old${i}`, `o${i}`, 1, "2026-11-01 05:00:00"));
    page1.push(row("n1", "m-last", 1, "2026-11-05 10:00:00"));
    const page2 = [row("n2", "m-last", 2, "2026-11-05 11:00:00")];
    const saved: Game[] = [];
    const res = await runUpdate(snapshot("2026-11-03 12:00:00"), [], {
      fetch: fakeFetch([page1, page2]), sleep: async () => {}, save: async (gs) => void saved.push(...gs.map((g) => structuredClone(g))),
    });
    expect(res.fetched).toBe(PAGE + 1);
    expect(res.added).toBe(2);
    const g2 = res.local.find((g) => g.id === "LP_n2")!;
    expect(g2.fearlessUsed).toContain("Kn1");
    expect(saved.filter((g) => g.id === "LP_n2").at(-1)!.fearlessUsed).toContain("Kn1");
  });

  it("bị giới hạn giữa chừng: các trang đã lấy vẫn được lưu", async () => {
    const page1: Row[] = [];
    for (let i = 0; i < PAGE; i++) page1.push(row(`g${i}`, `m${i}`, 1, `2026-11-05 10:${String(i % 60).padStart(2, "0")}:00`));
    const saved: Game[] = [];
    await expect(
      runUpdate(snapshot("2026-11-03 12:00:00"), [], {
        fetch: fakeFetch([page1, "limit"]), sleep: async () => {}, budgetMs: 3000, firstWaitMs: 1000,
        save: async (gs) => void saved.push(...gs),
      }),
    ).rejects.toBeInstanceOf(RateLimitError);
    expect(saved.length).toBe(PAGE);
  });
});

describe("mergeLocal", () => {
  const resolve = leagueResolver(["LCK"]);
  const mk = (id: string, date: string, league = "LCK") =>
    buildGame(row(id, "m" + id, 1, date, { L_League_Short: league }), [], resolve, new Map([["LCK", 2026]]))!;

  it("thêm ván mới vào index, bỏ ván web đã có", () => {
    const m = mergeLocal(snapshot("2026-11-03 12:00:00"), [
      mk("a", "2026-11-02 10:00:00"), mk("b", "2026-11-05 10:00:00"), mk("c", "2026-11-05 12:00:00", "NewLeague"),
    ]);
    expect(m.stale).toEqual(["LP_a"]);
    const lck = m.index.leagues.find((l) => l.league === "LCK")!;
    expect(lck.games).toBe(11);
    expect(lck.localGames).toBe(1);
    expect(lck.lastDate).toBe("2026-11-05 10:00:00");
    expect(lck.patches["26.21"]).toBe(1);
    expect(m.byFile.get("2026/LCK.json")!.map((g) => g.id)).toEqual(["LP_b"]);
    const nl = m.index.leagues.find((l) => l.league === "NewLeague")!;
    expect(nl.file).toBe("2026/NewLeague.json");
    expect(nl.tier).toBe("2");
    expect(m.index.patches[0].patch).toBe("26.21");
  });

  it("lùi 3 ngày so với ván mới nhất", () => {
    expect(sinceFor(snapshot("2026-11-03 12:00:00"), [])).toBe("2026-10-31 00:00:00");
    expect(sinceFor(snapshot("2026-11-03 12:00:00"), [mk("b", "2026-11-05 10:00:00")])).toBe("2026-11-02 00:00:00");
    expect(sinceFor(null, [], new Date("2026-11-06T10:00:00Z"))).toBe("2026-10-23 00:00:00");
  });
});
