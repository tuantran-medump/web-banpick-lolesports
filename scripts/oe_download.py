#!/usr/bin/env python3
"""
Tải file CSV theo năm của Oracle's Elixir (oracleselixir.com).

Chỉ dùng thư viện chuẩn của Python 3.8+.

Oracle's Elixir để file trên một thư mục Google Drive công khai. Script này:
  1. Lấy mã file Drive theo tên file "<năm>_LoL_esports_match_data_from_OraclesElixir.csv",
     từ biến môi trường OE_FILE_IDS (nếu có) hoặc bằng cách đọc danh sách thư mục Drive.
  2. Tải file về (tự vượt trang "Google không quét được virus" của file lớn).
  3. Kiểm tra dòng đầu là tiêu đề CSV của Oracle's Elixir.
  4. Nếu Drive không được, thử link S3 cũ của Oracle's Elixir.

Cách dùng:
  python oe_download.py 2026                    # tải vào thư mục raw/
  python oe_download.py 2025 2026 --dir raw
  python oe_download.py 2027 --optional         # năm chưa có file thì bỏ qua, không báo lỗi

Biến môi trường (không bắt buộc):
  OE_DRIVE_FOLDER_ID  mã thư mục Google Drive của Oracle's Elixir
  OE_FILE_IDS         chỉ định thẳng mã file, ví dụ "2026=1AbC...,2025=1XyZ..."
"""
import argparse
import html
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_FOLDER_ID = "1gLSw0RLjBbtaNy0dgnGQDAZOHIgCe-HH"
FILE_NAME = "{year}_LoL_esports_match_data_from_OraclesElixir.csv"
S3_URL = "https://oracleselixir-downloadable-match-data.s3-us-west-2.amazonaws.com/" + FILE_NAME
UA = "Mozilla/5.0 (compatible; banpick-data-bot/1.0)"
HEADER_START = b"gameid,"


def get(url, retries=4):
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            return urllib.request.urlopen(req, timeout=120)
        except urllib.error.HTTPError as e:
            if e.code in (403, 404):
                raise
            last = e
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            last = e
        time.sleep(2 ** (i + 1))
    raise last


def list_folder(folder_id):
    """Trả về {tên file: mã file} của thư mục Drive công khai."""
    url = f"https://drive.google.com/embeddedfolderview?id={folder_id}"
    page = get(url).read().decode("utf-8", "replace")
    files = {}
    for m in re.finditer(r'id="entry-([\w-]+)".*?class="flip-entry-title">([^<]+)<', page, re.S):
        files[html.unescape(m.group(2)).strip()] = m.group(1)
    if not files:  # dự phòng nếu Google đổi giao diện
        for m in re.finditer(r'/file/d/([\w-]{20,})[^"]*"[^>]*>(?:(?!</a>).)*?(\d{4}_LoL_esports_match_data_from_OraclesElixir\.csv)',
                             page, re.S):
            files[m.group(2)] = m.group(1)
    return files


def stream_to(resp, path):
    """Ghi phản hồi ra file và trả về None. Nếu phản hồi không phải CSV (vd. trang HTML),
    không ghi gì và trả về phần đầu của phản hồi."""
    first = resp.read(64 * 1024)
    if not first.lstrip(b"\xef\xbb\xbf").startswith(HEADER_START):
        return first
    tmp = path + ".part"
    with open(tmp, "wb") as f:
        f.write(first)
        while True:
            chunk = resp.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)
    os.replace(tmp, path)
    return None


def download_drive(file_id, path):
    url = ("https://drive.usercontent.google.com/download?"
           + urllib.parse.urlencode({"id": file_id, "export": "download", "confirm": "t"}))
    page = stream_to(get(url), path)
    if page is None:
        return True
    # Trang xác nhận tải file lớn: gửi lại form với các trường ẩn
    text = page.decode("utf-8", "replace")
    form = re.search(r'<form[^>]+action="([^"]+)"', text)
    fields = dict(re.findall(r'<input type="hidden" name="([^"]+)" value="([^"]*)"', text))
    if form and fields:
        url = html.unescape(form.group(1)) + "?" + urllib.parse.urlencode(fields)
        if stream_to(get(url), path) is None:
            return True
    print(f"  Drive trả về trang không phải CSV: {text[:200]!r}", file=sys.stderr)
    return False


def download_s3(year, path):
    try:
        return stream_to(get(S3_URL.format(year=year)), path) is None
    except urllib.error.HTTPError as e:
        print(f"  S3: HTTP {e.code}", file=sys.stderr)
        return False


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("years", nargs="+", type=int)
    ap.add_argument("--dir", default="raw", help="thư mục lưu CSV")
    ap.add_argument("--optional", action="store_true", help="năm không có file thì bỏ qua")
    a = ap.parse_args()
    os.makedirs(a.dir, exist_ok=True)

    ids = {}
    for part in filter(None, (os.environ.get("OE_FILE_IDS") or "").split(",")):
        y, _, fid = part.partition("=")
        ids[int(y.strip())] = fid.strip()

    folder = None
    failed = []
    for year in a.years:
        name = FILE_NAME.format(year=year)
        path = os.path.join(a.dir, name)
        print(f"{name}:", file=sys.stderr)
        fid = ids.get(year)
        if not fid:
            if folder is None:
                folder_id = os.environ.get("OE_DRIVE_FOLDER_ID") or DEFAULT_FOLDER_ID
                try:
                    folder = list_folder(folder_id)
                    print(f"  Thư mục Drive có {len(folder)} file", file=sys.stderr)
                except Exception as e:  # noqa: BLE001
                    print(f"  Không đọc được thư mục Drive {folder_id}: {e}", file=sys.stderr)
                    folder = {}
            fid = folder.get(name)
        ok = False
        if fid:
            print(f"  Tải từ Google Drive (id {fid})", file=sys.stderr)
            try:
                ok = download_drive(fid, path)
            except Exception as e:  # noqa: BLE001
                print(f"  Lỗi Drive: {e}", file=sys.stderr)
        if not ok:
            print("  Thử link S3 cũ", file=sys.stderr)
            ok = download_s3(year, path)
        if ok:
            print(f"  OK, {os.path.getsize(path) / 1e6:.1f} MB", file=sys.stderr)
        else:
            failed.append(year)
            print("  KHÔNG tải được", file=sys.stderr)
            if os.environ.get("GITHUB_ACTIONS"):
                print(f"::warning::Không tải được {name}")

    if failed and not a.optional:
        sys.exit(f"Không tải được năm: {failed}")


if __name__ == "__main__":
    main()
