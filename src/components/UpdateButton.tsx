import { useEffect, useRef, useState } from "react";
import { RateLimitError } from "../leaguepedia";
import { clearLocalGames, getLocalGames, putLocalGames } from "../localdb";
import { runUpdate, type UpdateStatus } from "../local";
import type { DataIndex, Game } from "../types";
import { CsvImport } from "./CsvImport";

const COOLDOWN_KEY = "lp-cooldown-until";
const AFTER_OK = 60_000; // bấm lại sau 1 phút
const AFTER_LIMIT = 5 * 60_000; // bị giới hạn tốc độ: nghỉ 5 phút

const readCooldown = () => {
  try {
    return Number(localStorage.getItem(COOLDOWN_KEY)) || 0;
  } catch {
    return 0;
  }
};
const writeCooldown = (until: number) => {
  try {
    localStorage.setItem(COOLDOWN_KEY, String(until));
  } catch {
    /* bỏ qua */
  }
};

interface Props {
  snapshot: DataIndex | null;
  local: Game[];
  counts: { lp: number; csv: number }; // số ván trong trình duyệt còn mới hơn dữ liệu của web, theo nguồn
  onLocal: (games: Game[]) => void;
}

/** Nút "Cập nhật": lấy ván mới hơn dữ liệu của web từ Leaguepedia, lưu trong trình duyệt. */
export function UpdateButton({ snapshot, local, counts, onLocal }: Props) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [cooldown, setCooldown] = useState(readCooldown);
  const [now, setNow] = useState(Date.now());
  const ctrl = useRef<AbortController | null>(null);

  const running = status !== null;
  const waitingLeft = status?.kind === "waiting" ? Math.max(0, Math.ceil((status.until - now) / 1000)) : 0;
  const coolLeft = Math.max(0, Math.ceil((cooldown - now) / 1000));

  // Đồng hồ cho các dòng đếm ngược.
  useEffect(() => {
    if (!running && coolLeft <= 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running, coolLeft > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => ctrl.current?.abort(), []);

  async function start() {
    if (!snapshot || running) return;
    const c = new AbortController();
    ctrl.current = c;
    setMsg(null);
    let until = Date.now() + AFTER_OK;
    try {
      const res = await runUpdate(snapshot, local, { signal: c.signal, save: putLocalGames, onStatus: setStatus });
      setMsg({
        text: res.added
          ? `Đã thêm ${res.added} ván mới từ Leaguepedia.`
          : "Không có ván mới hơn dữ liệu đang có.",
      });
    } catch (e) {
      const saved = "Những ván đã lấy được vẫn được lưu, lần sau bấm Cập nhật sẽ lấy tiếp.";
      if (c.signal.aborted) setMsg({ text: `Đã dừng. ${saved}` });
      else if (e instanceof RateLimitError) {
        until = Date.now() + AFTER_LIMIT;
        setMsg({ text: `${e.message} ${saved} Thử lại sau vài phút.`, bad: true });
      } else setMsg({ text: `Không cập nhật được: ${(e as Error).message || e}`, bad: true });
    } finally {
      ctrl.current = null;
      setStatus(null);
      writeCooldown(until);
      setCooldown(until);
      setNow(Date.now());
      onLocal(await getLocalGames());
    }
  }

  async function clear() {
    await clearLocalGames();
    onLocal([]);
    setMsg({ text: "Đã xóa các ván cập nhật và CSV đã nạp trong trình duyệt này." });
  }

  let label = "Cập nhật";
  if (running) label = "Đang cập nhật…";
  else if (coolLeft > 0) label = `Cập nhật (${coolLeft}s)`;

  return (
    <div className="updater" aria-live="polite">
      <div className="updater-row">
        <button type="button" className="btn primary" onClick={start} disabled={!snapshot || running || coolLeft > 0}
          title="Lấy các ván mới hơn dữ liệu của web từ Leaguepedia, lưu trong trình duyệt này">
          {label}
        </button>
        {running && (
          <button type="button" className="btn" onClick={() => ctrl.current?.abort()}>Dừng</button>
        )}
        <CsvImport snapshot={snapshot} disabled={running} onLocal={onLocal} onMessage={setMsg} />
        {!running && counts.lp + counts.csv > 0 && (
          <span className="muted small">
            {[counts.csv && `+${counts.csv} ván từ CSV`, counts.lp && `+${counts.lp} ván từ Leaguepedia`].filter(Boolean).join(", ")} ·{" "}
            <button type="button" className="link small" onClick={clear}>xóa</button>
          </span>
        )}
      </div>
      {status && (
        <div className="muted small">
          {status.kind === "waiting"
            ? `${status.reason}, thử lại sau ${waitingLeft}s…`
            : "Đang lấy dữ liệu từ Leaguepedia…"}
          {status.fetched > 0 && ` Đã đọc ${status.fetched} ván, ${status.added} ván mới.`}
        </div>
      )}
      {msg && !running && <div className={`small ${msg.bad ? "bad-text" : "muted"}`}>{msg.text}</div>}
    </div>
  );
}
