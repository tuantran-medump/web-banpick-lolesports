# web-banpick-lolesports

Web mô phỏng ban/pick cho LoL chuyên nghiệp (có Fearless), gợi ý ban/pick theo dữ liệu thi đấu.

## Web (giao diện)

Vite + React + TypeScript, mã nguồn trong `src/`. Web đọc thẳng các file JSON trong `public/data/`
và chỉ tải những giải cần cho bộ lọc đang chọn.

- Bộ lọc: tier, giải, khoảng ngày, phiên bản, ván 1–5, vòng (vòng bảng/playoffs), phe (xanh, đỏ, đội pick trước, đội pick sau) và đội.
  Bộ lọc được ghi lên URL (phần sau dấu `#`), gửi link là người khác thấy đúng bảng đó.
- Bảng tướng: presence, số pick và tỉ lệ pick, số ban và tỉ lệ ban, tỉ lệ thắng, số pick ở phe xanh/đỏ, số lần là pick đầu tiên.
  Bấm tiêu đề cột để sắp xếp. Khi lọc theo đội hoặc phe, mọi số liệu tính theo góc nhìn đội/phe đó và có thêm cột "Bị cấm" (đối thủ cấm tướng này).
- Ảnh tướng lấy từ Data Dragon của Riot (bản mới nhất), lưu trong trình duyệt một ngày.

Chạy trên máy (cần Node 22):

```
npm install
npm run dev      # mở http://localhost:5173
npm test
npm run build    # ra thư mục dist/
```

### Đưa lên Cloudflare Pages (dùng được với repo private)

1. Vào https://dash.cloudflare.com, mục **Workers & Pages** > **Create** > tab **Pages** > **Connect to Git**.
2. Cho phép Cloudflare truy cập GitHub, chọn repo `web-banpick-lolesports`.
3. Cấu hình build:
   - Production branch: `main`
   - Framework preset: `Vite` (hoặc chọn None rồi điền tay)
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Node lấy theo file `.node-version` (22), không cần thêm biến.
4. Bấm **Save and Deploy**. Web có địa chỉ dạng `https://<tên-project>.pages.dev`.

Mỗi lần workflow cập nhật dữ liệu commit vào `main`, Cloudflare tự build lại (Cloudflare tự theo dõi repo,
không phụ thuộc GitHub Actions). Mỗi PR cũng có một link xem trước riêng.
Muốn giới hạn người xem thì bật **Cloudflare Access** cho project (miễn phí tới 50 người).

## Dữ liệu

Nguồn: [Oracle's Elixir](https://oracleselixir.com) (file CSV theo năm). Nhớ ghi nguồn trên web.

Workflow `.github/workflows/update-data.yml` thử 3 tiếng một lần, mỗi ngày cập nhật một lần (Google hay giới hạn lượt tải file của Oracle's Elixir, nên cần thử nhiều lần). Chỉ báo lỗi khi đã hơn 2 ngày không cập nhật được từ cả hai nguồn.

1. `scripts/oe_download.py` tải CSV của năm trước và năm nay từ thư mục Google Drive của Oracle's Elixir.
2. `scripts/oe_convert.py` chuyển CSV thành JSON trong `public/data/`:
   - `public/data/index.json`: danh sách giải (tier, số game, số series, các phiên bản) và danh sách phiên bản.
   - `public/data/<năm>/<giải>.json`: từng game với ban/pick, thứ tự draft 20 lượt, series và danh sách tướng đã dùng (Fearless).
   Nếu không tải được (Google báo "Quota exceeded"), `scripts/lp_fallback.py` lấy các game mới hơn ngày cuối cùng đang có
   từ [Leaguepedia](https://lol.fandom.com) (Cargo API, giấy phép CC BY-SA) và ghi thêm vào cùng file, đánh dấu `"source": "leaguepedia"`.
   Lần sau tải được Oracle's Elixir thì toàn bộ dữ liệu được tạo lại từ CSV.
3. `scripts/oe_check.py` chặn ghi đè nếu số game của một năm giảm quá 10% (file tải về bị lỗi).
4. Ghi `public/data/meta.json` (ngày cập nhật) và commit vào `main`.

CSV của lần tải thành công gần nhất được giữ trong cache của Actions: năm nào hôm nay không tải được thì dùng lại bản cũ.
Không lấy được từ cả hai nguồn thì workflow chỉ cảnh báo và giữ nguyên dữ liệu.

### Tự đưa CSV lên (khi workflow không tự tải được)

1. Tải file CSV từ trang Oracle's Elixir về máy, nén thành `.zip` (GitHub web chỉ nhận file dưới 25 MB).
2. Trên GitHub, mở nhánh `main`, chọn "Add file" > "Upload files", đặt file vào thư mục `manual/`
   (gõ `manual/` trước tên file). Tên file cần có năm, ví dụ `2026.zip`.
3. Commit. Workflow tự chạy, chuyển đổi, commit dữ liệu mới và xóa file trong `manual/`.

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
"Quota exceeded". Có thể thêm khóa Drive API để có thêm một đường tải (lưu ý: thử ngày 2026-11-06 thì Drive API cũng bị giới hạn chung với link công khai):

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
