import { describe, expect, it } from "vitest";
import {
  act, availability, canNextGame, DRAFT_ORDER, fearlessLocked, newSeries, nextGame, parseSeries, setup,
  sideOfTurn, slotsOf, undo, type Series,
} from "./draft";

const CHAMPS = Array.from({ length: 40 }, (_, i) => `Champ${i}`);
const playGame = (s: Series, offset: number) => {
  for (let i = 0; i < 20; i++) s = act(s, CHAMPS[offset + i]);
  return s;
};

describe("thứ tự draft 2026", () => {
  it("có 20 lượt theo đúng luật", () => {
    const str = DRAFT_ORDER.map((s) => `${s.kind[0]}${s.turn}`).join(" ");
    expect(str).toBe(
      "bF bS bF bS bF bS pF pS pS pF pF pS bS bF bS bF pS pF pF pS",
    );
  });

  it("đội pick trước cũng ban trước dù ở phe đỏ", () => {
    let s = newSeries();
    s = setup(s, { blueTeam: 0, firstTeam: 1 }); // Đội 2 ở phe đỏ, được pick trước
    const g = s.games[0];
    expect(sideOfTurn(g, DRAFT_ORDER[0].turn)).toBe("red");
    expect(sideOfTurn(g, DRAFT_ORDER[6].turn)).toBe("red"); // pick đầu tiên
    s = act(s, "Ahri");
    expect(slotsOf(s.games[0], "red").bans[0]).toBe("Ahri");
    expect(slotsOf(s.games[0], "blue").bans[0]).toBeUndefined();
  });

  it("mỗi phe có 5 ban và 5 pick", () => {
    const g = playGame(newSeries(), 0).games[0];
    for (const side of ["blue", "red"] as const) {
      const sl = slotsOf(g, side);
      expect(sl.bans).toHaveLength(5);
      expect(sl.picks).toHaveLength(5);
      expect(sl.picks.every(Boolean)).toBe(true);
    }
  });

  it("không cho chọn lại tướng đã dùng, cho bỏ lượt cấm nhưng không bỏ lượt chọn", () => {
    let s = act(newSeries(), "Ahri");
    expect(act(s, "ahri")).toBe(s);
    for (let i = 0; i < 5; i++) s = act(s, null);
    expect(s.games[0].actions).toHaveLength(6);
    expect(act(s, null)).toBe(s); // lượt 7 là pick
  });

  it("không đổi phe được sau khi ván đã bắt đầu", () => {
    const s = act(newSeries(), "Ahri");
    expect(setup(s, { firstTeam: 1 })).toBe(s);
  });
});

describe("Fearless", () => {
  it("khóa tướng đã pick ở ván trước, không khóa tướng bị ban", () => {
    let s = playGame(newSeries(), 0);
    expect(canNextGame(s)).toBe(true);
    s = nextGame(s);
    const locked = fearlessLocked(s);
    expect(locked.size).toBe(10);
    expect(availability(s, "Champ6")).toEqual({ ok: false, reason: "fearless", game: 1 }); // lượt 7 = pick
    expect(availability(s, "Champ0")).toEqual({ ok: true }); // lượt 1 = ban
    expect(act(s, "Champ6")).toBe(s);
  });

  it("tắt Fearless thì không khóa", () => {
    let s = nextGame(playGame({ ...newSeries(), fearless: false }, 0));
    expect(availability(s, "Champ6").ok).toBe(true);
    s = act(s, "Champ6");
    expect(s.games[1].actions).toEqual(["Champ6"]);
  });

  it("không vượt quá số ván của thể thức", () => {
    let s: Series = { ...newSeries(), bestOf: 1 };
    s = playGame(s, 0);
    expect(canNextGame(s)).toBe(false);
    expect(nextGame(s)).toBe(s);
  });

  it("hoàn tác ở đầu ván mới thì quay về ván trước", () => {
    const s = nextGame(playGame(newSeries(), 0));
    const back = undo(s);
    expect(back.games).toHaveLength(1);
    expect(back.games[0].actions).toHaveLength(20);
  });
});

describe("lưu series", () => {
  it("đọc lại đúng và bỏ qua dữ liệu hỏng", () => {
    const s = nextGame(playGame(newSeries(), 0));
    expect(parseSeries(JSON.stringify(s))).toEqual(s);
    expect(parseSeries("{")).toBeNull();
    expect(parseSeries(JSON.stringify({ ...s, bestOf: 7 }))).toBeNull();
    expect(parseSeries(null)).toBeNull();
  });
});
