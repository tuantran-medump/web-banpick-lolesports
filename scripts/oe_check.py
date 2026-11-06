#!/usr/bin/env python3
"""
So sánh index.json mới với bản cũ để chặn ghi đè dữ liệu tốt bằng dữ liệu hỏng
(vd. file tải về bị cắt giữa chừng).

  python oe_check.py OLD_INDEX NEW_INDEX [--max-drop 0.1]

Với mỗi năm có ở cả hai bản, số game mới không được giảm quá max-drop (mặc định 10%).
Năm chỉ có ở bản cũ (vd. năm đã ra khỏi danh sách tải) thì bỏ qua.
"""
import argparse
import json
import os
import sys
from collections import Counter


def per_year(path):
    with open(path, encoding="utf-8") as f:
        idx = json.load(f)
    c = Counter()
    for it in idx["leagues"]:
        c[it["year"]] += it["games"]
    return c


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("old")
    ap.add_argument("new")
    ap.add_argument("--max-drop", type=float, default=0.1)
    a = ap.parse_args()
    new = per_year(a.new)
    print("Số game theo năm: " + ", ".join(f"{y}: {n}" for y, n in sorted(new.items())))
    if not os.path.exists(a.old):
        print("Chưa có bản cũ, bỏ qua so sánh.")
        return
    old = per_year(a.old)
    bad = []
    for y, n_old in sorted(old.items()):
        if y not in new:
            continue
        n_new = new[y]
        print(f"  {y}: {n_old} -> {n_new}")
        if n_new < n_old * (1 - a.max_drop):
            bad.append(y)
    if bad:
        sys.exit(f"Số game giảm quá {a.max_drop:.0%} ở năm {bad}. Có thể file tải về bị lỗi; không ghi đè.")


if __name__ == "__main__":
    main()
