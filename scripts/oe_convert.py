#!/usr/bin/env python3
"""
Giai đoạn 0: chuyển file CSV của Oracle's Elixir thành JSON gọn cho web banpick.

Chỉ dùng thư viện chuẩn của Python 3.8+, không cần pip install.

Cách dùng:
  python oe_convert.py 2026_LoL_esports_match_data_from_OraclesElixir.csv
  python oe_convert.py file.csv --league LCK          # chỉ lấy một giải
  python oe_convert.py file.csv --out public/data     # thư mục đầu ra (mặc định: data)
  python oe_convert.py 2025.csv 2026.csv               # gộp nhiều năm, tự bỏ dòng trùng

Đầu ra:
  <out>/<năm>/<giải>.json   danh sách game của giải đó
  <out>/index.json          danh sách giải, tier, số game, ngày mới nhất

Dữ liệu: Oracle's Elixir (oracleselixir.com). Nhớ ghi nguồn trên web.
"""
import argparse
import csv
import json
import os
import re
import sys
from collections import Counter, defaultdict

ROLES = ["top", "jng", "mid", "bot", "sup"]
EXPECTED = ["gameid", "league", "year", "date", "game", "patch", "side", "position",
            "teamname", "champion", "result"]
OPTIONAL = ["split", "playoffs", "datacompleteness", "url", "playername",
            "ban1", "ban2", "ban3", "ban4", "ban5", "pick1", "pick2", "pick3", "pick4", "pick5"]

# ---------------------------------------------------------------------------
# Tier
# ---------------------------------------------------------------------------

def load_tier_config():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tier_config.json")
    with open(path, encoding="utf-8") as f:
        cfg = json.load(f)
    lookup = {}
    for tier, leagues in cfg["tiers"].items():
        for name, codes in leagues.items():
            for code in codes:
                lookup[code.lower()] = (tier, name)
    return cfg["default"], lookup


DEFAULT_TIER, TIER_LOOKUP = load_tier_config()


def tier_of(league):
    return TIER_LOOKUP.get((league or "").strip().lower(), (DEFAULT_TIER, None))

# ---------------------------------------------------------------------------
# Đọc CSV
# ---------------------------------------------------------------------------

def read_games(paths, league_filter=None):
    """Gom các dòng theo gameid. Trả về {gameid: [rows]} và danh sách cột."""
    games = defaultdict(list)
    seen = set()
    columns = None
    for path in paths:
        with open(path, encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)
            cols = [c.strip() for c in reader.fieldnames]
            columns = columns or cols
            for row in reader:
                row = {k.strip(): (v or "").strip() for k, v in row.items() if k}
                if league_filter and row.get("league", "").lower() != league_filter.lower():
                    continue
                if not row.get("gameid"):
                    continue
                # Nhiều file (vd. 2025 + 2026) có thể chứa cùng một game: bỏ dòng trùng
                key = (row["gameid"], row.get("participantid"), row.get("side"), row.get("position"))
                if key in seen:
                    continue
                seen.add(key)
                games[row["gameid"]].append(row)
    return games, columns or []


def _none(v):
    return v if v and v.lower() not in ("nan", "null", "none") else None


def _int(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def build_game(gid, rows, has_picks):
    teams = {r["side"].lower(): r for r in rows if r.get("position", "").lower() == "team"}
    players = [r for r in rows if r.get("position", "").lower() in ROLES]
    if set(teams) != {"blue", "red"}:
        return None, "thiếu dòng đội xanh/đỏ"
    any_row = teams["blue"]
    league = any_row.get("league")
    tier, tier_league = tier_of(league)

    sides = {}
    for side in ("blue", "red"):
        t = teams[side]
        roster = {r["position"].lower(): r for r in players if r.get("side", "").lower() == side}
        picks = [_none(t.get(f"pick{i}")) for i in range(1, 6)] if has_picks else []
        if not any(picks):
            # Không có cột pick theo thứ tự: lấy tướng theo vị trí, thứ tự pick không biết
            picks = [_none(roster.get(r, {}).get("champion")) for r in ROLES]
        sides[side] = {
            "team": t.get("teamname"),
            "win": t.get("result") == "1",
            "bans": [_none(t.get(f"ban{i}")) for i in range(1, 6)],
            "picks": picks,
            "roles": {r: {"champion": _none(roster.get(r, {}).get("champion")),
                          "player": _none(roster.get(r, {}).get("playername"))} for r in ROLES},
        }

    winner = "blue" if sides["blue"]["win"] else ("red" if sides["red"]["win"] else None)
    # Từ 2026 đội được chọn phe HOẶC lượt pick đầu, nên phe đỏ có thể pick trước.
    fp = "red" if teams["red"].get("firstPick") == "1" else (
        "blue" if teams["blue"].get("firstPick") == "1" else None)
    first = fp or "blue"
    second = "red" if first == "blue" else "blue"
    return {
        "id": gid,
        "league": league,
        "tier": tier,
        "tierLeague": tier_league,
        "year": _int(any_row.get("year")),
        "split": _none(any_row.get("split")),
        "playoffs": any_row.get("playoffs") == "1",
        "date": any_row.get("date"),
        "patch": _none(any_row.get("patch")),
        "patchLabel": patch_label(any_row.get("patch")),
        "gameInSeries": _int(any_row.get("game")),
        "complete": (any_row.get("datacompleteness") or "complete") == "complete",
        "picksOrdered": has_picks and any(_none(teams["blue"].get(f"pick{i}")) for i in range(1, 6)),
        "winner": winner,
        "firstPickSide": fp,
        "blue": sides["blue"],
        "red": sides["red"],
        "draft": draft_order(sides[first], sides[second], first, second),
    }, None


def patch_label(p):
    """Oracle's Elixir ghi số phiên bản nội bộ (16.07); Riot gọi là 26.07 từ năm 2026 (15.x -> 25.x)."""
    m = re.match(r"^(\d+)\.(\d+)", p or "")
    if not m:
        return None
    major = int(m.group(1))
    return f"{major + 10 if major >= 15 else major}.{int(m.group(2)):02d}"


def patch_key(label):
    a, b = label.split(".")
    return (int(a), int(b))


def draft_order(B, R, first="blue", second="red"):
    """20 lượt theo thứ tự chuẩn: [loại, phe, tướng]. B = đội có lượt pick đầu; theo luật
    First Selection 2026, đội này cũng ban trước, dù đứng phe xanh hay đỏ."""
    b, r = B["bans"], R["bans"]
    p, q = B["picks"], R["picks"]
    F, S = first, second
    seq = [("ban", F, b[0]), ("ban", S, r[0]), ("ban", F, b[1]), ("ban", S, r[1]),
           ("ban", F, b[2]), ("ban", S, r[2]),
           ("pick", F, p[0]), ("pick", S, q[0]), ("pick", S, q[1]),
           ("pick", F, p[1]), ("pick", F, p[2]), ("pick", S, q[2]),
           ("ban", S, r[3]), ("ban", F, b[3]), ("ban", S, r[4]), ("ban", F, b[4]),
           ("pick", S, q[3]), ("pick", F, p[3]), ("pick", F, p[4]), ("pick", S, q[4])]
    return [list(x) for x in seq]

# ---------------------------------------------------------------------------
# Gom series (CSV không có mã series)
# ---------------------------------------------------------------------------

def assign_series(games):
    """Cùng giải + cùng hai đội + cùng ngày, số ván tăng dần = một series.
    Gắn seriesId và fearlessUsed (tướng đã pick ở các ván trước trong series)."""
    groups = defaultdict(list)
    for g in games:
        key = (g["league"], (g["date"] or "")[:10],
               tuple(sorted([g["blue"]["team"] or "", g["red"]["team"] or ""])))
        groups[key].append(g)
    for key, gs in groups.items():
        gs.sort(key=lambda g: (g["date"] or "", g["gameInSeries"] or 0, g["id"]))
        n, prev, used = 0, None, []
        for g in gs:
            num = g["gameInSeries"] or 0
            if prev is None or num <= prev:
                n += 1
                used = []
            sid = f'{key[0]}|{key[1]}|{key[2][0]}|{key[2][1]}|{n}'
            g["seriesId"] = sid
            g["fearlessUsed"] = sorted(set(used))
            used = used + [c for side in ("blue", "red") for c in g[side]["picks"] if c]
            prev = num


def slug(s):
    return re.sub(r"[^A-Za-z0-9._-]+", "_", s or "unknown").strip("_") or "unknown"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv", nargs="+", help="file CSV của Oracle's Elixir")
    ap.add_argument("--league", help="chỉ lấy giải có mã này, ví dụ LCK")
    ap.add_argument("--out", default="data", help="thư mục đầu ra")
    a = ap.parse_args()

    print("Đang đọc CSV...", file=sys.stderr)
    raw, columns = read_games(a.csv, a.league)
    missing = [c for c in EXPECTED if c not in columns]
    missing_opt = [c for c in OPTIONAL if c not in columns]
    if missing:
        sys.exit(f"Thiếu cột bắt buộc: {missing}\nCác cột có trong file: {columns}")
    if missing_opt:
        print(f"Lưu ý, thiếu cột phụ: {missing_opt}", file=sys.stderr)
    has_picks = "pick1" in columns

    games, problems = [], Counter()
    for gid, rows in raw.items():
        g, err = build_game(gid, rows, has_picks)
        if g:
            games.append(g)
        else:
            problems[err] += 1
    if not games:
        sys.exit("Không có game nào hợp lệ trong file CSV, dừng lại để không ghi đè dữ liệu cũ.")
    assign_series(games)

    by_file = defaultdict(list)
    for g in games:
        by_file[(g["year"], g["league"])].append(g)

    index = []
    for (year, league), gs in sorted(by_file.items(), key=lambda kv: (kv[0][0] or 0, kv[0][1] or "")):
        gs.sort(key=lambda g: (g["date"] or "", g["gameInSeries"] or 0, g["id"]))
        rel = f"{year}/{slug(league)}.json"
        path = os.path.join(a.out, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"source": "Oracle's Elixir (oracleselixir.com)", "league": league,
                       "year": year, "games": gs}, f, ensure_ascii=False, separators=(",", ":"))
        index.append({"league": league, "year": year, "tier": gs[0]["tier"], "file": rel,
                      "games": len(gs), "series": len({g["seriesId"] for g in gs}),
                      "firstDate": gs[0]["date"], "lastDate": gs[-1]["date"],
                      "maxGameInSeries": max(g["gameInSeries"] or 0 for g in gs),
                      "patches": dict(sorted(Counter(g["patchLabel"] for g in gs if g["patchLabel"]).items(),
                                             key=lambda kv: patch_key(kv[0])))})
    os.makedirs(a.out, exist_ok=True)
    # Danh sách phiên bản: số game, ngày đầu/cuối (dùng cho bộ lọc và trọng số theo độ mới)
    pv = {}
    for g in games:
        lb = g["patchLabel"]
        if not lb:
            continue
        e = pv.setdefault(lb, {"patch": lb, "internal": g["patch"], "games": 0, "tier1Games": 0,
                               "firstDate": g["date"], "lastDate": g["date"]})
        e["games"] += 1
        e["tier1Games"] += g["tier"] == "1"
        e["firstDate"] = min(e["firstDate"], g["date"])
        e["lastDate"] = max(e["lastDate"], g["date"])
    patches = sorted(pv.values(), key=lambda e: patch_key(e["patch"]), reverse=True)
    with open(os.path.join(a.out, "index.json"), "w", encoding="utf-8") as f:
        json.dump({"source": "Oracle's Elixir (oracleselixir.com)", "patches": patches,
                   "leagues": index}, f, ensure_ascii=False, indent=1)

    # ---- Báo cáo kiểm tra ----
    print(f"\n{len(games)} game, {len(index)} giải. Ghi vào {a.out}/", file=sys.stderr)
    if problems:
        print(f"Bỏ qua: {dict(problems)}", file=sys.stderr)
    print(f"Có cột pick theo thứ tự: {'có' if has_picks else 'KHÔNG'}", file=sys.stderr)
    print("\nTier  Giải            Năm   Game  Series  Ngày cuối", file=sys.stderr)
    for it in sorted(index, key=lambda x: (x["tier"], -x["games"])):
        print(f'{it["tier"]:<5} {it["league"] or "?":<15} {it["year"]} {it["games"]:>5} {it["series"]:>7}  '
              f'{(it["lastDate"] or "")[:10]}', file=sys.stderr)
    t1 = [g for g in games if g["tier"] == "1"]
    if t1:
        pres, n = Counter(), len(t1)
        for g in t1:
            for s in ("blue", "red"):
                pres.update(set(c for c in g[s]["picks"] + g[s]["bans"] if c))
        print(f"\nTop 10 presence ở Tier 1 ({n} game):", file=sys.stderr)
        for c, v in pres.most_common(10):
            print(f"  {c:<15} {v / n:6.1%}", file=sys.stderr)
    print("\nPhiên bản (mới nhất trước): " + ", ".join(f'{e["patch"]} ({e["games"]})' for e in patches),
          file=sys.stderr)
    fp_red = sum(g["firstPickSide"] == "red" for g in games) / max(len(games), 1)
    print(f"Phe đỏ có lượt pick đầu: {fp_red:.1%} số game", file=sys.stderr)
    blue_wr = sum(g["winner"] == "blue" for g in games) / max(len(games), 1)
    print(f"\nTỉ lệ thắng phe xanh: {blue_wr:.1%} (thường khoảng 50–55%)", file=sys.stderr)


if __name__ == "__main__":
    main()
