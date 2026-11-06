# web-banpick-lolesports

Web mô phỏng ban/pick cho LoL chuyên nghiệp (có Fearless), gợi ý ban/pick theo dữ liệu thi đấu.

## Dữ liệu

Nguồn: [Oracle's Elixir](https://oracleselixir.com) (file CSV theo năm). Nhớ ghi nguồn trên web.

Workflow `.github/workflows/update-data.yml` chạy mỗi ngày lúc 13:30 giờ Việt Nam:

1. `scripts/oe_download.py` tải CSV của năm trước và năm nay từ thư mục Google Drive của Oracle's Elixir.
2. `scripts/oe_convert.py` chuyển CSV thành JSON trong `public/data/`:
   - `public/data/index.json`: danh sách giải (tier, số game, số series, các phiên bản) và danh sách phiên bản.
   - `public/data/<năm>/<giải>.json`: từng game với ban/pick, thứ tự draft 20 lượt, series và danh sách tướng đã dùng (Fearless).
3. `scripts/oe_check.py` chặn ghi đè nếu số game của một năm giảm quá 10% (file tải về bị lỗi).
4. Có thay đổi thì commit vào `main`.

Có thể chạy tay ở tab Actions, mục "Run workflow", và nhập năm (ví dụ `2024 2025 2026`).

### Quy ước

- Tier theo `scripts/tier_config.json`. Tier 1: LCK, LPL, LEC, First Stand, MSI, Worlds, EWC. Tier 1.5: LCP, LCS, CBLOL, Demacia Cup. Còn lại là Tier 2.
- Thứ tự draft: đội có lượt pick đầu cũng ban trước, dù ở phe xanh hay đỏ (luật First Selection 2026).
  Ban 1: F S F S F S. Pick 1: F S S F F S. Ban 2: S F S F. Pick 2: S F F S (F = đội pick đầu).
- Phiên bản: Oracle's Elixir ghi số nội bộ (16.07), web hiển thị theo tên Riot (26.07).

### Biến của repo (Settings > Secrets and variables > Actions > Variables), đều không bắt buộc

- `OE_YEARS`: các năm cần tải, ví dụ `2025 2026`.
- `OE_DRIVE_FOLDER_ID`: mã thư mục Google Drive nếu Oracle's Elixir đổi thư mục.
- `OE_FILE_IDS`: chỉ định thẳng mã file Drive, ví dụ `2026=1AbC...,2025=1XyZ...`.

### Khóa Google Drive API (secret `GOOGLE_API_KEY`)

File của Oracle's Elixir rất nhiều người tải nên link Drive công khai hay bị Google báo
"Quota exceeded". Drive API dùng hạn mức riêng, nên nên thêm một khóa API:

1. Vào https://console.cloud.google.com, tạo project (miễn phí).
2. "APIs & Services" > "Library", bật **Google Drive API**.
3. "APIs & Services" > "Credentials" > "Create credentials" > "API key". Nên giới hạn khóa chỉ cho Google Drive API.
4. Trong repo: Settings > Secrets and variables > Actions > New repository secret, tên `GOOGLE_API_KEY`.

### Chạy trên máy

```
python scripts/oe_download.py 2026
python scripts/oe_convert.py raw/*.csv --out public/data
python -m unittest discover -s tests
```

Chỉ cần Python 3.8+, không cần cài thêm thư viện.
