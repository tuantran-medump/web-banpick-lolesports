import { describe, expect, it } from "vitest";
import { buildGame, leagueResolver } from "./leaguepedia";
import { countBySource, mergeLocal, newerThanSnapshot } from "./local";
import { CSV_SOURCE, CsvParser, openZipCsv, readOeFile } from "./oe";
import type { DataIndex, Game } from "./types";

import SAMPLE from "../tests/fixtures/sample.csv?raw";

/** File .zip một file, nén deflate (giống file người dùng tự nén). */
async function makeZip(name: string, text: string): Promise<Blob> {
  const data = new TextEncoder().encode(text);
  const comp = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
  const nm = new TextEncoder().encode(name);
  const local = new DataView(new ArrayBuffer(30));
  local.setUint32(0, 0x04034b50, true);
  local.setUint16(8, 8, true);
  local.setUint32(18, comp.length, true);
  local.setUint32(22, data.length, true);
  local.setUint16(26, nm.length, true);
  const cd = new DataView(new ArrayBuffer(46));
  cd.setUint32(0, 0x02014b50, true);
  cd.setUint16(10, 8, true);
  cd.setUint32(20, comp.length, true);
  cd.setUint32(24, data.length, true);
  cd.setUint16(28, nm.length, true);
  cd.setUint32(42, 0, true);
  const cdOffset = 30 + nm.length + comp.length;
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, 1, true);
  end.setUint16(10, 1, true);
  end.setUint32(12, 46 + nm.length, true);
  end.setUint32(16, cdOffset, true);
  return new Blob([local.buffer, nm, comp, cd.buffer, nm, end.buffer]);
}

describe("CsvParser", () => {
  it("đọc ô có ngoặc kép, dấu phẩy, xuống dòng và CRLF, kể cả khi bị cắt giữa đoạn", () => {
    const rows: string[][] = [];
    const p = new CsvParser((r) => rows.push(r));
    const text = 'a,b,c\r\n"x, y","say ""hi""","line\nbreak"\r\n1,,3';
    for (let i = 0; i < text.length; i += 3) p.push(text.slice(i, i + 3));
    p.end();
    expect(rows).toEqual([["a", "b", "c"], ["x, y", 'say "hi"', "line\nbreak"], ["1", "", "3"]]);
  });
});

describe("readOeFile", () => {
  it("đổi CSV mẫu giống oe_convert.py", async () => {
    const { games, skipped } = await readOeFile(new File([SAMPLE], "sample.csv"));
    expect(skipped).toBe(0);
    expect(games.length).toBe(4);
    const g = games.find((x) => x.id === "LOLTMNT03_337058")!;
    expect(g.league).toBe("LCK");
    expect(g.tier).toBe("1");
    expect(g.patchLabel).toBe("26.01");
    expect(g.source).toBe(CSV_SOURCE);
    expect(g.draft).toHaveLength(20);
    expect(g.seriesId).toMatch(/^LCK\|2026-01-14\|/);
    // Ván 2 cùng series: Fearless khóa tướng đã pick ở ván 1
    const g2 = games.find((x) => x.seriesId === g.seriesId && x.gameInSeries === 2);
    expect(g2).toBeDefined();
    expect(g2!.fearlessUsed).toEqual(expect.arrayContaining(g.blue.picks.filter(Boolean) as string[]));
  });

  it("đọc được file .zip", async () => {
    const zip = await makeZip("2026_LoL.csv", SAMPLE);
    const z = await openZipCsv(zip);
    expect(z.name).toBe("2026_LoL.csv");
    const { games, name } = await readOeFile(new File([zip], "2026.zip"));
    expect(name).toBe("2026_LoL.csv");
    expect(games.length).toBe(4);
  });

  it("báo lỗi khi không phải CSV của Oracle's Elixir", async () => {
    await expect(readOeFile(new File(["a,b\n1,2\n"], "x.csv"))).rejects.toThrow(/thiếu cột/);
  });
});

describe("gộp CSV với dữ liệu web và Leaguepedia", () => {
  const snapshot: DataIndex = {
    source: "test",
    patches: [],
    leagues: [{
      league: "LCK", year: 2026, tier: "1", file: "2026/LCK.json", games: 1, series: 1, firstDate: "2026-01-01 00:00:00",
      lastDate: "2026-01-10 00:00:00", maxGameInSeries: 1, patches: {},
    }],
  };
  const lp = (id: string, date: string): Game =>
    buildGame({ SG_GameId: id, SG_Team1: "A", SG_Team2: "B", SG_DateTime_UTC: date, L_League_Short: "LCK" }, [], leagueResolver(["LCK"]), new Map())!;

  it("chỉ lưu ván web chưa có, và ván CSV thay ván Leaguepedia cùng khoảng thời gian", async () => {
    const { games } = await readOeFile(new File([SAMPLE], "sample.csv"));
    const fresh = newerThanSnapshot(snapshot, games);
    expect(fresh.length).toBe(games.filter((g) => g.league !== "LCK" || g.date > "2026-01-10 00:00:00").length);
    const csvLast = fresh.filter((g) => g.league === "LCK").map((g) => g.date).sort().at(-1)!;
    const older = lp("old", "2026-01-12 00:00:00");
    const newer = lp("new", "2099-01-01 00:00:00");
    const m = mergeLocal(snapshot, [...fresh, older, newer]);
    expect(csvLast > older.date).toBe(true);
    expect(m.stale).toContain("LP_old");
    expect(m.stale).not.toContain("LP_new");
    const n = countBySource(m);
    expect(n.lp).toBe(1);
    expect(n.csv).toBe(fresh.length);
  });
});
