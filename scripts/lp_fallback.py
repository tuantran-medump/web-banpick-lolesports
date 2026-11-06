#!/usr/bin/env python3
"""
Nguồn dự phòng: lấy game mới từ Leaguepedia (lol.fandom.com, Cargo API) khi không tải
được CSV của Oracle's Elixir.

Chỉ dùng thư viện chuẩn của Python 3.8+.

Script đọc dữ liệu đang có trong thư mục data, tìm ngày game cuối cùng của từng giải
(từ Oracle's Elixir), rồi lấy từ Leaguepedia các game sau ngày đó, đổi sang cùng định dạng
với oe_convert.py và ghi thêm vào file của giải. Game lấy từ Leaguepedia có "source":
"leaguepedia". Lần sau tải được Oracle's Elixir thì cả thư mục được tạo lại từ CSV, nên các
game này tự được thay bằng dữ liệu của Oracle's Elixir.

Cách dùng:
  python lp_fallback.py --data public/data             # ghi thẳng vào public/data
  python lp_fallback.py --data public/data --out build # ghi ra chỗ khác (để thử)
  python lp_fallback.py --days 7 --out build           # chưa có dữ liệu: lấy 7 ngày gần nhất
"""
import argparse
import datetime
import http.cookiejar
import json
import os
import re
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import oe_convert as oe  # noqa: E402

API = "https://lol.fandom.com/api.php"
UA = "banpick-data-bot/1.0 (https://github.com/tuantran-medump/web-banpick-lolesports)"
PAGE = 500
SOURCE = "leaguepedia"

WANT = {
    "ScoreboardGames": ["GameId", "MatchId", "OverviewPage", "Tournament", "Team1", "Team2", "Winner",
                        "WinTeam", "DateTime_UTC", "Patch", "Team1Bans", "Team2Bans", "Team1Picks",
                        "Team2Picks", "Team1Players", "Team2Players", "N_GameInMatch"],
    "PicksAndBansS7": ([f"Team{t}{k}{i}" for t in (1, 2) for k in ("Ban", "Pick") for i in range(1, 6)]
                       + ["Team1PicksByRoleOrder", "Team2PicksByRoleOrder"]),
    "Tournaments": ["League", "Year", "Split", "IsPlayoffs", "Region"],
    "Leagues": ["League_Short"],
}
ALIAS = {"ScoreboardGames": "SG", "PicksAndBansS7": "PB", "Tournaments": "T", "Leagues": "L"}


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

BUDGET = 150  # tổng số giây tối đa dành cho việc chờ khi Leaguepedia giới hạn tốc độ
_deadline = None
_opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def _call(params, post=None):
    url = API + "?" + urllib.parse.urlencode({**params, "format": "json"})
    data = urllib.parse.urlencode(post).encode() if post else None
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
    with _opener.open(req, timeout=60) as r:
        return json.load(r)


def login():
    """Đăng nhập bằng bot password (Special:BotPasswords) nếu có LP_BOT_USER/LP_BOT_PASSWORD.
    Người dùng đăng nhập được Leaguepedia cho giới hạn tốc độ rộng hơn khách."""
    user, pw = os.environ.get("LP_BOT_USER"), os.environ.get("LP_BOT_PASSWORD")
    if not (user and pw):
        return
    token = _call({"action": "query", "meta": "tokens", "type": "login"})["query"]["tokens"]["logintoken"]
    res = _call({"action": "login"}, {"lgname": user, "lgpassword": pw, "lgtoken": token})
    print(f"  Đăng nhập Leaguepedia: {res.get('login', {}).get('result')}", file=sys.stderr)


def api(params):
    global _deadline
    if _deadline is None:
        _deadline = time.time() + BUDGET
    wait = 10
    while True:
        try:
            data = _call(params)
            err = data.get("error")
            if not err:
                return data
            if err.get("code") not in ("ratelimited", "maxlag"):
                raise RuntimeError(f"Leaguepedia báo lỗi: {err}")
            reason = "Leaguepedia giới hạn tốc độ"
        except (urllib.error.URLError, TimeoutError, ConnectionError, ValueError) as e:
            reason = f"Lỗi mạng: {e}"
        left = _deadline - time.time()
        if left <= 0:
            raise RuntimeError(f"{reason}; hết {BUDGET}s chờ, bỏ cuộc lần này")
        w = min(wait, left)
        print(f"  {reason}, chờ {w:.0f}s", file=sys.stderr, flush=True)
        time.sleep(w)
        wait *= 2


def table_fields(table):
    data = api({"action": "cargofields", "table": table})
    return set(data.get("cargofields", {}).keys())


def norm(row):
    return {k.replace(" ", "_"): (v if v is not None else "") for k, v in row.items()}


def fetch_games(since):
    """Các game (ScoreboardGames + PicksAndBansS7 + giải) có DateTime_UTC > since."""
    fields, extra = [], {}
    for table, want in WANT.items():
        have = table_fields(table)
        time.sleep(1)
        a = ALIAS[table]
        for name in want:
            if name in have:
                fields.append(f"{a}.{name}={a}_{name}")
        # Từ 2026 đội pick đầu có thể ở phe đỏ: tìm cột ghi lượt pick đầu nếu Leaguepedia có
        for name in sorted(have):
            if re.search(r"first_?pick", name, re.I) and table in ("ScoreboardGames", "PicksAndBansS7"):
                fields.append(f"{a}.{name}={a}_{name}")
                extra.setdefault("firstPick", []).append(f"{a}_{name}")
    if not any(f.startswith("SG.GameId=") for f in fields):
        raise RuntimeError("Không đọc được cấu trúc bảng ScoreboardGames")
    print(f"  Cột lượt pick đầu: {extra.get('firstPick') or 'không có (coi như phe xanh pick đầu)'}",
          file=sys.stderr)
    rows, offset = [], 0
    while True:
        data = api({
            "action": "cargoquery",
            "tables": "ScoreboardGames=SG,PicksAndBansS7=PB,Tournaments=T,Leagues=L",
            "join_on": "SG.GameId=PB.GameId,SG.OverviewPage=T.OverviewPage,T.League=L.League",
            "fields": ",".join(fields),
            "where": f'SG.DateTime_UTC > "{since}"',
            "order_by": "SG.DateTime_UTC",
            "limit": PAGE,
            "offset": offset,
        })
        batch = [norm(x["title"]) for x in data.get("cargoquery", [])]
        rows += batch
        print(f"  Đã lấy {len(rows)} game", file=sys.stderr)
        if len(batch) < PAGE:
            break
        offset += PAGE
        time.sleep(3)
    return rows, extra.get("firstPick", [])


# ---------------------------------------------------------------------------
# Chuyển đổi
# ---------------------------------------------------------------------------

def split_list(v):
    return [x.strip() or None for x in (v or "").split(",")] if v else []


def pad(lst, n=5):
    return (list(lst) + [None] * n)[:n]


def league_resolver(known_codes):
    """Đổi tên giải của Leaguepedia sang mã của Oracle's Elixir nếu được."""
    lookup = {c.lower(): c for c in known_codes}
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "tier_config.json"), encoding="utf-8") as f:
        cfg = json.load(f)
    for leagues in cfg["tiers"].values():
        for name, codes in leagues.items():
            for alias in codes + [name]:
                lookup.setdefault(alias.lower(), codes[0])

    def resolve(short, full):
        for v in (short, full):
            if v and v.strip().lower() in lookup:
                return lookup[v.strip().lower()]
        return (short or full or "Unknown").strip()
    return resolve


def patch_internal(p):
    m = re.match(r"^(\d+)\.(\d+)", p or "")
    if not m:
        return None
    major = int(m.group(1))
    if major >= 25:  # Leaguepedia ghi theo tên Riot (26.07) -> số nội bộ (16.07) như Oracle's Elixir
        major -= 10
    return f"{major}.{int(m.group(2)):02d}"


def first_pick_side(r, cols, t1, t2):
    for c in cols:
        v = (r.get(c) or "").strip()
        if not v:
            continue
        low = v.lower()
        team_col = re.match(r"^(SG|PB)_Team([12])", c)
        if team_col:
            if low in ("1", "yes", "true", "y"):
                return "blue" if team_col.group(2) == "1" else "red"
            continue
        if low in ("1", "blue", "team1") or v == t1:
            return "blue"
        if low in ("2", "red", "team2") or v == t2:
            return "red"
    return None


def build_game(r, fp_cols, resolve, league_year):
    t1, t2 = r.get("SG_Team1"), r.get("SG_Team2")
    date = (r.get("SG_DateTime_UTC") or "")[:19]
    if not (r.get("SG_GameId") and t1 and t2 and date):
        return None
    league = resolve(r.get("L_League_Short"), r.get("T_League"))
    tier, tier_league = oe.tier_of(league)
    year = league_year.get(league) or oe._int(r.get("T_Year")) or int(date[:4])
    has_pb = any(r.get(f"PB_Team1Pick{i}") for i in range(1, 6))
    sides = {}
    for n, side in ((1, "blue"), (2, "red")):
        if has_pb:
            bans = [r.get(f"PB_Team{n}Ban{i}") or None for i in range(1, 6)]
            picks = [r.get(f"PB_Team{n}Pick{i}") or None for i in range(1, 6)]
        else:
            bans = pad(split_list(r.get(f"SG_Team{n}Bans")))
            picks = pad(split_list(r.get(f"SG_Team{n}Picks")))
        by_role = pad(split_list(r.get(f"PB_Team{n}PicksByRoleOrder")) or split_list(r.get(f"SG_Team{n}Picks")))
        players = pad(split_list(r.get(f"SG_Team{n}Players")))
        sides[side] = {
            "team": t1 if n == 1 else t2,
            "win": r.get("SG_Winner") == str(n) or r.get("SG_WinTeam") == (t1 if n == 1 else t2),
            "bans": [None if b in ("None", "Loss of Ban") else b for b in bans],
            "picks": picks,
            "roles": {role: {"champion": by_role[i], "player": players[i]} for i, role in enumerate(oe.ROLES)},
        }
    winner = "blue" if sides["blue"]["win"] else ("red" if sides["red"]["win"] else None)
    fp = first_pick_side(r, fp_cols, t1, t2)
    first = fp or "blue"
    second = "red" if first == "blue" else "blue"
    patch = patch_internal(r.get("SG_Patch"))
    return {
        "id": "LP_" + r["SG_GameId"],
        "league": league,
        "tier": tier,
        "tierLeague": tier_league,
        "year": year,
        "split": r.get("T_Split") or None,
        "playoffs": (r.get("T_IsPlayoffs") or "").lower() in ("1", "yes", "true"),
        "date": date,
        "patch": patch,
        "patchLabel": oe.patch_label(patch),
        "gameInSeries": oe._int(r.get("SG_N_GameInMatch")),
        "complete": True,
        "picksOrdered": has_pb,
        "winner": winner,
        "firstPickSide": fp,
        "blue": sides["blue"],
        "red": sides["red"],
        "draft": oe.draft_order(sides[first], sides[second], first, second),
        "source": SOURCE,
        "_match": r.get("SG_MatchId") or r["SG_GameId"],
    }


def assign_series_by_match(games):
    groups = defaultdict(list)
    for g in games:
        groups[g.pop("_match")].append(g)
    for mid, gs in groups.items():
        gs.sort(key=lambda g: (g["gameInSeries"] or 0, g["date"]))
        used = []
        for g in gs:
            g["seriesId"] = "lp|" + mid
            g["fearlessUsed"] = sorted(set(used))
            used += [c for side in ("blue", "red") for c in g[side]["picks"] if c]


# ---------------------------------------------------------------------------

def load_games(data_dir):
    path = os.path.join(data_dir, "index.json")
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        index = json.load(f)
    games = []
    for it in index["leagues"]:
        with open(os.path.join(data_dir, it["file"]), encoding="utf-8") as f:
            games += json.load(f)["games"]
    return games


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", default="public/data", help="thư mục dữ liệu đang có")
    ap.add_argument("--out", help="thư mục ghi kết quả (mặc định: ghi đè vào --data)")
    ap.add_argument("--days", type=int, default=7, help="chưa có dữ liệu thì lấy bao nhiêu ngày gần nhất")
    ap.add_argument("--overlap-days", type=int, default=3,
                    help="lấy lùi lại bao nhiêu ngày so với game mới nhất (giải nào cũng được kiểm tra riêng)")
    a = ap.parse_args()
    out = a.out or a.data

    existing = load_games(a.data)
    oe_games = [g for g in existing if g.get("source") != SOURCE]
    last_by_league, league_year = {}, {}
    for g in oe_games:
        if g["date"] and g["date"] > last_by_league.get(g["league"], ""):
            last_by_league[g["league"]] = g["date"]
            league_year[g["league"]] = g["year"]
    now = datetime.datetime.now(datetime.timezone.utc)
    if last_by_league:
        newest = datetime.datetime.strptime(max(last_by_league.values())[:10], "%Y-%m-%d")
        since = (newest - datetime.timedelta(days=a.overlap_days)).strftime("%Y-%m-%d 00:00:00")
    else:
        since = (now - datetime.timedelta(days=a.days)).strftime("%Y-%m-%d 00:00:00")
    print(f"Leaguepedia: lấy game sau {since} (UTC)", file=sys.stderr)

    login()
    rows, fp_cols = fetch_games(since)
    resolve = league_resolver(last_by_league.keys())
    new = []
    for r in rows:
        g = build_game(r, fp_cols, resolve, league_year)
        # Chỉ lấy game mới hơn game cuối cùng của giải đó trong dữ liệu Oracle's Elixir
        if g and g["date"] > last_by_league.get(g["league"], since):
            new.append(g)
    assign_series_by_match(new)

    all_games = oe_games + new
    if out != a.data:
        if os.path.exists(out):
            shutil.rmtree(out)
        if os.path.isdir(a.data):
            shutil.copytree(a.data, out)
    old_keys = {(g["year"], g["league"]) for g in existing if g.get("source") == SOURCE}
    new_files = oe.group_by_file(all_games)
    for key in old_keys | {(g["year"], g["league"]) for g in new}:
        if key in new_files:
            oe.write_league_file(out, key[0], key[1], new_files[key])
        else:
            path = os.path.join(out, oe.league_file(*key))
            if os.path.exists(path):
                os.remove(path)
    if all_games:
        oe.write_index(out, all_games)

    meta_path = os.path.join(out, "meta.json")
    meta = {}
    if os.path.exists(meta_path):
        with open(meta_path, encoding="utf-8") as f:
            meta = json.load(f)
    meta["leaguepedia"] = {"fetched": now.strftime("%Y-%m-%d"), "since": since, "games": len(new)}
    os.makedirs(out, exist_ok=True)
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)

    by_league = defaultdict(int)
    for g in new:
        by_league[g["league"]] += 1
    print(f"\nThêm {len(new)} game từ Leaguepedia (bỏ {len(rows) - len(new)} game đã có):", file=sys.stderr)
    for lg, n in sorted(by_league.items(), key=lambda kv: -kv[1]):
        print(f"  {lg:<15} {n:>4}  tier {oe.tier_of(lg)[0]}", file=sys.stderr)
    fp_red = sum(g["firstPickSide"] == "red" for g in new)
    print(f"Game phe đỏ pick đầu: {fp_red}/{len(new)}", file=sys.stderr)


if __name__ == "__main__":
    main()
