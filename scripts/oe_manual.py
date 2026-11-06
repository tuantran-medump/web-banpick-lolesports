#!/usr/bin/env python3
"""
Lấy file CSV do bạn tự đưa lên thư mục manual/ (dùng khi workflow không tự tải được).

Nhận file .csv hoặc .zip (nén lại cho nhẹ, GitHub web chỉ cho tải lên file dưới 25 MB).
Tên file phải có năm, ví dụ 2026_LoL_esports_match_data_from_OraclesElixir.csv hoặc 2026.zip.
File được chép vào thư mục raw/ với tên chuẩn.

  python oe_manual.py manual raw
"""
import os
import re
import shutil
import sys
import zipfile

NAME = "{year}_LoL_esports_match_data_from_OraclesElixir.csv"


def year_of(name):
    m = re.search(r"(20\d\d)", os.path.basename(name))
    return m.group(1) if m else None


def main():
    src, dst = sys.argv[1], sys.argv[2]
    os.makedirs(dst, exist_ok=True)
    found = []
    for f in sorted(os.listdir(src)) if os.path.isdir(src) else []:
        path = os.path.join(src, f)
        if f.lower().endswith(".zip"):
            with zipfile.ZipFile(path) as z:
                for info in z.infolist():
                    if info.filename.lower().endswith(".csv"):
                        y = year_of(info.filename) or year_of(f)
                        if not y:
                            sys.exit(f"Không biết năm của {f}/{info.filename}: tên file cần có năm, vd. 2026")
                        out = os.path.join(dst, NAME.format(year=y))
                        with z.open(info) as i, open(out, "wb") as o:
                            shutil.copyfileobj(i, o)
                        found.append(out)
        elif f.lower().endswith(".csv"):
            y = year_of(f)
            if not y:
                sys.exit(f"Không biết năm của {f}: tên file cần có năm, vd. 2026")
            out = os.path.join(dst, NAME.format(year=y))
            shutil.copyfile(path, out)
            found.append(out)
    for out in found:
        with open(out, "rb") as fh:
            if not fh.read(64).lstrip(b"\xef\xbb\xbf").startswith(b"gameid,"):
                sys.exit(f"{out} không giống file CSV của Oracle's Elixir (dòng đầu phải bắt đầu bằng gameid,)")
        print(f"Dùng file tự đưa lên: {out} ({os.path.getsize(out) / 1e6:.1f} MB)")
    if not found:
        print("Không có file trong manual/")


if __name__ == "__main__":
    main()
