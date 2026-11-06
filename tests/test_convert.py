"""Kiểm tra oe_convert.py trên một mẫu nhỏ lấy từ CSV 2026 thật của Oracle's Elixir.

Chạy: python -m unittest discover -s tests
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "scripts")
SAMPLE = os.path.join(ROOT, "tests", "fixtures", "sample.csv")
sys.path.insert(0, SCRIPTS)
import oe_convert  # noqa: E402


def convert(*csvs):
    out = tempfile.mkdtemp()
    subprocess.run([sys.executable, os.path.join(SCRIPTS, "oe_convert.py"), *csvs, "--out", out],
                   check=True, capture_output=True)
    with open(os.path.join(out, "index.json"), encoding="utf-8") as f:
        index = json.load(f)
    games = {}
    for it in index["leagues"]:
        with open(os.path.join(out, it["file"]), encoding="utf-8") as f:
            for g in json.load(f)["games"]:
                games[g["id"]] = g
    return out, index, games


class ConvertTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.out, cls.index, cls.games = convert(SAMPLE)

    def test_tiers(self):
        tiers = {it["league"]: it["tier"] for it in self.index["leagues"]}
        self.assertEqual(tiers, {"LCK": "1", "LCP": "1.5"})
        self.assertEqual(oe_convert.tier_of("WLDs")[0], "1")
        self.assertEqual(oe_convert.tier_of("FST")[0], "1")
        self.assertEqual(oe_convert.tier_of("DCup")[0], "1.5")
        self.assertEqual(oe_convert.tier_of("LCKC")[0], "2")

    def test_draft_order_first_pick_team_bans_first(self):
        for g in self.games.values():
            F = g["firstPickSide"] or "blue"
            S = "red" if F == "blue" else "blue"
            d = g["draft"]
            self.assertEqual(len(d), 20)
            sides = "".join("F" if side == F else "S" for _, side, _ in d)
            self.assertEqual(sides, "FSFSFS" + "FSSFFS" + "SFSF" + "SFFS")
            kinds = "".join(k[0] for k, _, _ in d)
            self.assertEqual(kinds, "bbbbbb" + "pppppp" + "bbbb" + "pppp")
            self.assertEqual(d[0][2], g[F]["bans"][0])
            self.assertEqual(d[6][2], g[F]["picks"][0])
            self.assertEqual(d[7][2], g[S]["picks"][0])

    def test_red_first_pick_exists(self):
        self.assertTrue(any(g["firstPickSide"] == "red" for g in self.games.values()))

    def test_series_and_fearless(self):
        lck = sorted((g for g in self.games.values() if g["league"] == "LCK"),
                     key=lambda g: g["gameInSeries"])
        self.assertEqual([g["gameInSeries"] for g in lck], [1, 2, 3])
        self.assertEqual(len({g["seriesId"] for g in lck}), 1)
        self.assertEqual(lck[0]["fearlessUsed"], [])
        used_1 = {c for s in ("blue", "red") for c in lck[0][s]["picks"] if c}
        self.assertEqual(set(lck[1]["fearlessUsed"]), used_1)
        self.assertEqual(len(lck[2]["fearlessUsed"]), 20)

    def test_patch_label(self):
        self.assertEqual(oe_convert.patch_label("16.07"), "26.07")
        self.assertEqual(oe_convert.patch_label("15.24"), "25.24")
        self.assertEqual(oe_convert.patch_label("14.1"), "14.01")

    def test_duplicate_files_are_deduped(self):
        _, index, games = convert(SAMPLE, SAMPLE)
        self.assertEqual(games.keys(), self.games.keys())
        self.assertEqual(sum(it["games"] for it in index["leagues"]), len(self.games))
        for gid, g in games.items():
            self.assertEqual(g["draft"], self.games[gid]["draft"])


class CheckTest(unittest.TestCase):
    def run_check(self, old_games, new_games):
        d = tempfile.mkdtemp()
        paths = []
        for name, n in (("old", old_games), ("new", new_games)):
            p = os.path.join(d, name + ".json")
            with open(p, "w") as f:
                json.dump({"leagues": [{"year": 2026, "games": n}]}, f)
            paths.append(p)
        return subprocess.run([sys.executable, os.path.join(SCRIPTS, "oe_check.py"), *paths],
                              capture_output=True).returncode

    def test_small_drop_ok(self):
        self.assertEqual(self.run_check(1000, 950), 0)

    def test_big_drop_fails(self):
        self.assertNotEqual(self.run_check(1000, 500), 0)


if __name__ == "__main__":
    unittest.main()
