// Đọc file CSV của Oracle's Elixir (hoặc file .zip chứa CSV) ngay trong trình duyệt.
// Cách chuyển giống scripts/oe_convert.py: gom dòng theo gameid, lấy ban/pick theo thứ tự,
// đội pick trước ban trước (luật 2026), gom series theo giải + hai đội + ngày.

import { draftOrder, patchLabel, tierOf } from "./leaguepedia";
import { ROLES, type Game, type Role, type Side, type TeamSide } from "./types";

export const CSV_SOURCE = "csv";

const EXPECTED = ["gameid", "league", "year", "date", "game", "patch", "side", "position", "teamname", "champion", "result"];
const OPTIONAL = ["split", "playoffs", "datacompleteness", "participantid", "playername", "firstPick",
  "ban1", "ban2", "ban3", "ban4", "ban5", "pick1", "pick2", "pick3", "pick4", "pick5"];
const KEEP = [...EXPECTED, ...OPTIONAL];

type Rec = Record<string, string>;

// ---------------------------------------------------------------------------
// CSV: đọc dần từng đoạn để file 80 MB không phải nằm hết trong bộ nhớ
// ---------------------------------------------------------------------------

/** Bộ đọc CSV theo RFC 4180 (có ngoặc kép, xuống dòng trong ô), nhận dữ liệu từng đoạn. */
export class CsvParser {
  private field = "";
  private row: string[] = [];
  private quoted = false;
  private afterQuote = false;
  constructor(private onRow: (row: string[]) => void) {}

  push(chunk: string) {
    let field = this.field;
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];
      if (this.quoted) {
        if (c === '"') {
          this.quoted = false;
          this.afterQuote = true;
        } else field += c;
        continue;
      }
      if (c === '"') {
        if (this.afterQuote) field += '"'; // "" trong ô có ngoặc kép
        this.quoted = true;
        this.afterQuote = false;
      } else if (c === ",") {
        this.row.push(field);
        field = "";
        this.afterQuote = false;
      } else if (c === "\n") {
        this.row.push(field.endsWith("\r") ? field.slice(0, -1) : field);
        field = "";
        this.afterQuote = false;
        this.onRow(this.row);
        this.row = [];
      } else {
        field += c;
        this.afterQuote = false;
      }
    }
    this.field = field;
  }

  end() {
    if (this.field || this.row.length) {
      this.row.push(this.field.endsWith("\r") ? this.field.slice(0, -1) : this.field);
      this.onRow(this.row);
    }
    this.field = "";
    this.row = [];
  }
}

// ---------------------------------------------------------------------------
// Đổi dòng CSV sang Game
// ---------------------------------------------------------------------------

const none = (v?: string) => (v && !["nan", "null", "none"].includes(v.toLowerCase()) ? v : null);
const toInt = (v?: string) => {
  const n = Math.trunc(parseFloat(v || ""));
  return Number.isFinite(n) ? n : null;
};

export class OeConverter {
  private idx: Record<string, number> | null = null;
  private games = new Map<string, Rec[]>();
  private seen = new Set<string>();
  hasPicks = false;
  rows = 0;

  /** Nhận một dòng CSV (dòng đầu là tiêu đề). */
  add = (cells: string[]) => {
    if (!this.idx) {
      const cols = cells.map((c) => c.replace(/^﻿/, "").trim());
      const missing = EXPECTED.filter((c) => !cols.includes(c));
      if (missing.length) throw new Error(`File không giống CSV của Oracle's Elixir (thiếu cột ${missing.join(", ")})`);
      this.idx = Object.fromEntries(KEEP.filter((c) => cols.includes(c)).map((c) => [c, cols.indexOf(c)]));
      this.hasPicks = cols.includes("pick1");
      return;
    }
    if (cells.length < 2) return;
    const r: Rec = {};
    for (const [k, i] of Object.entries(this.idx)) r[k] = (cells[i] ?? "").trim();
    if (!r.gameid) return;
    this.rows++;
    const key = `${r.gameid}|${r.participantid}|${r.side}|${r.position}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    let list = this.games.get(r.gameid);
    if (!list) this.games.set(r.gameid, (list = []));
    list.push(r);
  };

  /** Các ván đổi được và số ván bỏ (thiếu dòng đội). */
  finish(): { games: Game[]; skipped: number } {
    if (!this.idx) throw new Error("File trống");
    const games: Game[] = [];
    let skipped = 0;
    for (const [gid, rows] of this.games) {
      const g = buildOeGame(gid, rows, this.hasPicks);
      if (g) games.push(g);
      else skipped++;
    }
    assignOeSeries(games);
    return { games, skipped };
  }
}

export function buildOeGame(gid: string, rows: Rec[], hasPicks: boolean): Game | null {
  const teams: Partial<Record<Side, Rec>> = {};
  for (const r of rows) if (r.position?.toLowerCase() === "team") teams[r.side?.toLowerCase() as Side] = r;
  if (!teams.blue || !teams.red) return null;
  const players = rows.filter((r) => (ROLES as string[]).includes(r.position?.toLowerCase()));
  const any = teams.blue;
  const league = any.league;
  const [tier, tierLeague] = tierOf(league);

  const sides = {} as Record<Side, TeamSide>;
  for (const side of ["blue", "red"] as Side[]) {
    const t = teams[side]!;
    const roster = new Map<string, Rec>();
    for (const r of players) if (r.side?.toLowerCase() === side) roster.set(r.position.toLowerCase(), r);
    let picks = hasPicks ? [1, 2, 3, 4, 5].map((i) => none(t[`pick${i}`])) : [];
    // Không có thứ tự pick: lấy tướng theo vị trí.
    if (!picks.some(Boolean)) picks = ROLES.map((role) => none(roster.get(role)?.champion));
    sides[side] = {
      team: t.teamname || null,
      win: t.result === "1",
      bans: [1, 2, 3, 4, 5].map((i) => none(t[`ban${i}`])),
      picks,
      roles: Object.fromEntries(
        ROLES.map((role) => [role, { champion: none(roster.get(role)?.champion), player: none(roster.get(role)?.playername) }]),
      ) as Record<Role, { champion: string | null; player: string | null }>,
    };
  }
  const winner: Side | null = sides.blue.win ? "blue" : sides.red.win ? "red" : null;
  const fp: Side | null = teams.red.firstPick === "1" ? "red" : teams.blue.firstPick === "1" ? "blue" : null;
  const first: Side = fp || "blue";
  const second: Side = first === "blue" ? "red" : "blue";
  const patch = none(any.patch);
  return {
    id: gid,
    league,
    tier,
    tierLeague,
    year: toInt(any.year),
    split: none(any.split),
    playoffs: any.playoffs === "1",
    date: any.date,
    patch,
    patchLabel: patchLabel(any.patch),
    gameInSeries: toInt(any.game),
    complete: (any.datacompleteness || "complete") === "complete",
    picksOrdered: hasPicks && [1, 2, 3, 4, 5].some((i) => none(teams.blue![`pick${i}`])),
    winner,
    firstPickSide: fp,
    blue: sides.blue,
    red: sides.red,
    draft: draftOrder(sides[first], sides[second], first, second),
    seriesId: "",
    fearlessUsed: [],
    source: CSV_SOURCE,
  };
}

/** Cùng giải + cùng hai đội + cùng ngày, số ván tăng dần = một series (giống oe_convert.py). */
export function assignOeSeries(games: Game[]) {
  const groups = new Map<string, Game[]>();
  for (const g of games) {
    const pair = [g.blue.team || "", g.red.team || ""].sort();
    const key = `${g.league}|${(g.date || "").slice(0, 10)}|${pair[0]}|${pair[1]}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(g);
  }
  for (const [key, gs] of groups) {
    gs.sort((a, b) => a.date.localeCompare(b.date) || (a.gameInSeries ?? 0) - (b.gameInSeries ?? 0) || a.id.localeCompare(b.id));
    let n = 0;
    let prev: number | null = null;
    let used: string[] = [];
    for (const g of gs) {
      const num = g.gameInSeries ?? 0;
      if (prev === null || num <= prev) {
        n++;
        used = [];
      }
      g.seriesId = `${key}|${n}`;
      g.fearlessUsed = [...new Set(used)].sort();
      used = [...used, ...[g.blue, g.red].flatMap((s) => s.picks.filter((c): c is string => !!c))];
      prev = num;
    }
  }
}

// ---------------------------------------------------------------------------
// File .zip: tự giải nén CSV đầu tiên (trình duyệt có sẵn DecompressionStream)
// ---------------------------------------------------------------------------

async function bytes(blob: Blob, start: number, end: number) {
  return new DataView(await blob.slice(start, end).arrayBuffer());
}

/** Mở file CSV đầu tiên trong file .zip, trả về luồng dữ liệu đã giải nén. */
export async function openZipCsv(file: Blob): Promise<{ name: string; size: number; stream: ReadableStream<Uint8Array> }> {
  const tailStart = Math.max(0, file.size - 65_557);
  const tail = await bytes(file, tailStart, file.size);
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("File .zip bị lỗi (không thấy mục lục)");
  const count = tail.getUint16(eocd + 10, true);
  const cdSize = tail.getUint32(eocd + 12, true);
  const cdOffset = tail.getUint32(eocd + 16, true);
  const cd = await bytes(file, cdOffset, cdOffset + cdSize);
  const dec = new TextDecoder();
  let p = 0;
  for (let k = 0; k < count && p + 46 <= cd.byteLength; k++) {
    if (cd.getUint32(p, true) !== 0x02014b50) break;
    const method = cd.getUint16(p + 10, true);
    const compSize = cd.getUint32(p + 20, true);
    const size = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    const local = cd.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!/\.csv$/i.test(name) || /(^|\/)(__MACOSX|\.)/.test(name)) continue;
    const lh = await bytes(file, local, local + 30);
    if (lh.getUint32(0, true) !== 0x04034b50) throw new Error("File .zip bị lỗi");
    const dataStart = local + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
    const raw = file.slice(dataStart, dataStart + compSize).stream();
    if (method === 0) return { name, size, stream: raw };
    if (method !== 8) throw new Error("File .zip nén theo kiểu không hỗ trợ, hãy nén lại bằng zip thường");
    return { name, size, stream: raw.pipeThrough(new DecompressionStream("deflate-raw")) };
  }
  throw new Error("Trong file .zip không có file .csv");
}

export interface ReadProgress {
  read: number; // byte đã đọc (CSV chưa nén)
  total: number;
}

/** Đọc CSV (hoặc .zip chứa CSV) thành danh sách ván. */
export async function readOeFile(
  file: File, onProgress?: (p: ReadProgress) => void,
): Promise<{ games: Game[]; skipped: number; name: string }> {
  let name = file.name;
  let total = file.size;
  let stream: ReadableStream<Uint8Array>;
  if (/\.zip$/i.test(file.name)) {
    const z = await openZipCsv(file);
    ({ name, stream } = z);
    total = z.size;
  } else stream = file.stream();
  const conv = new OeConverter();
  const parser = new CsvParser(conv.add);
  const decoder = new TextDecoder("utf-8");
  const reader = stream.getReader();
  let read = 0;
  let lastReport = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    read += value.byteLength;
    parser.push(decoder.decode(value, { stream: true }));
    if (read - lastReport > 2_000_000) {
      lastReport = read;
      onProgress?.({ read, total });
    }
  }
  parser.push(decoder.decode());
  parser.end();
  onProgress?.({ read: total, total });
  return { ...conv.finish(), name };
}
