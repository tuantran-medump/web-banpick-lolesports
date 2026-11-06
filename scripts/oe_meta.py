#!/usr/bin/env python3
"""Ghi meta.json: ngày cập nhật (UTC) và các file CSV đã dùng.

  python oe_meta.py RAW_DIR OUT_FILE
"""
import datetime
import json
import os
import sys


def main():
    raw, out = sys.argv[1], sys.argv[2]
    files = sorted(f for f in os.listdir(raw) if f.endswith(".csv"))
    meta = {
        "source": "Oracle's Elixir (oracleselixir.com)",
        "updated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d"),
        "files": {f: os.path.getsize(os.path.join(raw, f)) for f in files},
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    print(json.dumps(meta, ensure_ascii=False))


if __name__ == "__main__":
    main()
