"""Kiểm tra lp_fallback.py với dữ liệu Leaguepedia giả (không gọi mạng)."""
import datetime
import json
import os
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "scripts")
SAMPLE = os.path.join(ROOT, "tests", "fixtures", "sample.csv")
sys.path.insert(0, SCRIPTS)
import lp_fallback  # noqa: E402

PICKS1 = ["Rumble", "Vi", "Orianna", "Varus", "Nautilus"]
PICKS2 = ["Jayce", "Nocturne", "Ryze", "Ezreal", "Bard"]


def row(gid, match, n, date, league_short="LCK", fp=None, team1="T1", team2="Gen.G"):
    r = {"SG_GameId": gid, "SG_MatchId": match, "SG_Team1": team1, "SG_Team2": team2, "SG_Winner": "2",
         "SG_DateTime_UTC": date, "SG_Patch": "26.21", "SG_N_GameInMatch": str(n),
         "SG_Team1Players": "A,B,C,D,E", "SG_Team2Players": "F,G,H,I,J",
         "SG_Team1Picks": ",".join(PICKS1), "SG_Team2Picks": ",".join(PICKS2),
         "L_League_Short": league_short, "T_League": "LoL Champions Korea", "T_Year": "2026"}
    for i in range(5):
        r[f"PB_Team1Ban{i + 1}"] = f"B1_{gid}_{i}"
        r[f"PB_Team2Ban{i + 1}"] = f"B2_{gid}_{i}"
        r[f"PB_Team1Pick{i + 1}"] = PICKS1[i]
        r[f"PB_Team2Pick{i + 1}"] = PICKS2[i]
    if fp:
        r["SG_FirstPick"] = fp
    return r


ROWS = [
    row("old", "m0", 1, "2026-01-10 08:00:00"),  # trước game cuối của LCK trong mẫu -> bỏ
    row("g1", "m1", 1, "2026-11-01 08:00:00", fp="Gen.G"),
    row("g2", "m1", 2, "2026-11-01 09:00:00", fp="T1"),
    row("w1", "m2", 1, "2026-11-02 08:00:00", league_short="Worlds"),
]


def run(data, out=None, extra=()):
    argv = ["lp_fallback.py", "--data", data] + (["--out", out] if out else []) + list(extra)
    with mock.patch.object(lp_fallback, "fetch_games", return_value=(ROWS, ["SG_FirstPick"])), \
            mock.patch.object(sys, "argv", argv):
        lp_fallback.main()


def load(data):
    with open(os.path.join(data, "index.json"), encoding="utf-8") as f:
        index = json.load(f)
    games = {}
    for it in index["leagues"]:
        with open(os.path.join(data, it["file"]), encoding="utf-8") as f:
            for g in json.load(f)["games"]:
                games[g["id"]] = g
    return index, games


class FallbackTest(unittest.TestCase):
    def setUp(self):
        self.data = tempfile.mkdtemp()
        subprocess.run([sys.executable, os.path.join(SCRIPTS, "oe_convert.py"), SAMPLE, "--out", self.data],
                       check=True, capture_output=True)
        _, self.oe_games = load(self.data)

    def test_adds_new_games_only(self):
        run(self.data)
        _, games = load(self.data)
        lp = {k: g for k, g in games.items() if g.get("source") == "leaguepedia"}
        self.assertEqual(set(lp), {"LP_g1", "LP_g2", "LP_w1"})
        self.assertEqual(len(games), len(self.oe_games) + 3)
        self.assertEqual(lp["LP_w1"]["league"], "WLDs")
        self.assertEqual(lp["LP_w1"]["tier"], "1")
        self.assertEqual(lp["LP_g1"]["patch"], "16.21")
        self.assertEqual(lp["LP_g1"]["patchLabel"], "26.21")
        self.assertEqual(lp["LP_g1"]["winner"], "red")
        self.assertEqual(lp["LP_g1"]["blue"]["roles"]["mid"], {"champion": "Orianna", "player": "C"})

    def test_first_pick_and_draft(self):
        run(self.data)
        _, games = load(self.data)
        g1, g2 = games["LP_g1"], games["LP_g2"]
        self.assertEqual(g1["firstPickSide"], "red")
        self.assertEqual(g1["draft"][0], ["ban", "red", "B2_g1_0"])
        self.assertEqual(g1["draft"][6], ["pick", "red", PICKS2[0]])
        self.assertEqual(g2["firstPickSide"], "blue")
        self.assertEqual(g2["draft"][0], ["ban", "blue", "B1_g2_0"])

    def test_fearless_within_match(self):
        run(self.data)
        _, games = load(self.data)
        self.assertEqual(games["LP_g1"]["seriesId"], games["LP_g2"]["seriesId"])
        self.assertEqual(games["LP_g1"]["fearlessUsed"], [])
        self.assertEqual(set(games["LP_g2"]["fearlessUsed"]), set(PICKS1 + PICKS2))

    def test_rerun_is_idempotent(self):
        run(self.data)
        idx1, g1 = load(self.data)
        run(self.data)
        idx2, g2 = load(self.data)
        self.assertEqual(g1.keys(), g2.keys())
        self.assertEqual(sum(i["games"] for i in idx1["leagues"]), sum(i["games"] for i in idx2["leagues"]))

    def test_no_existing_data(self):
        out = os.path.join(tempfile.mkdtemp(), "o")
        # --days sao cho mốc bắt đầu luôn là khoảng 2026-10-31, dù test chạy vào ngày nào
        days = (datetime.date.today() - datetime.date(2026, 10, 31)).days
        run(os.path.join(tempfile.mkdtemp(), "missing"), out, ["--days", str(days)])
        _, games = load(out)
        self.assertEqual(set(games), {"LP_g1", "LP_g2", "LP_w1"})  # "old" cũ hơn 7 ngày


if __name__ == "__main__":
    unittest.main()
