import { useRef, useState } from "react";
import { newerThanSnapshot } from "../local";
import { getLocalGames, putLocalGames } from "../localdb";
import { readOeFile, type ReadProgress } from "../oe";
import type { DataIndex, Game } from "../types";

interface Props {
  snapshot: DataIndex | null;
  disabled?: boolean;
  onLocal: (games: Game[]) => void;
  onMessage: (m: { text: string; bad?: boolean }) => void;
}

type Result = { games: Game[]; skipped: number; name: string };

/** Đọc file trong luồng riêng (Web Worker); trình duyệt không cho thì đọc ngay trên trang. */
function readInWorker(file: File, onProgress: (p: ReadProgress) => void): Promise<Result> {
  let worker: Worker;
  try {
    worker = new Worker(new URL("../oeWorker.ts", import.meta.url), { type: "module" });
  } catch {
    return readOeFile(file, onProgress);
  }
  return new Promise((resolve, reject) => {
    worker.onmessage = (e) => {
      const d = e.data;
      if (d.type === "progress") onProgress(d);
      else {
        worker.terminate();
        if (d.type === "done") resolve(d);
        else reject(new Error(d.message));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || "Không đọc được file"));
    };
    worker.postMessage(file);
  });
}

/** Nút "Nạp CSV": đọc file CSV (hoặc .zip) tải từ Oracle's Elixir, lưu các ván web chưa có vào trình duyệt. */
export function CsvImport({ snapshot, disabled, onLocal, onMessage }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);

  async function load(file: File) {
    setProgress(0);
    try {
      const r = await readInWorker(file, (p) => setProgress(p.total ? Math.min(99, Math.round((100 * p.read) / p.total)) : 0));
      const fresh = newerThanSnapshot(snapshot, r.games);
      await putLocalGames(fresh);
      onLocal(await getLocalGames());
      const known = r.games.length - fresh.length;
      onMessage({
        text: fresh.length
          ? `Đã nạp ${fresh.length} ván mới từ ${r.name}` + (known ? ` (bỏ ${known} ván web đã có).` : ".")
          : `${r.name} có ${r.games.length} ván, web đều đã có.`,
      });
    } catch (e) {
      onMessage({ text: `Không nạp được CSV: ${(e as Error).message || e}`, bad: true });
    } finally {
      setProgress(null);
      if (input.current) input.current.value = "";
    }
  }

  const busy = progress !== null;
  return (
    <>
      <button type="button" className="btn" disabled={disabled || busy || !snapshot} onClick={() => input.current?.click()}
        title="Chọn file CSV (hoặc .zip chứa CSV) tải từ oracleselixir.com; dữ liệu chỉ lưu trong trình duyệt này">
        {busy ? `Đang đọc CSV ${progress}%` : "Nạp CSV"}
      </button>
      <input ref={input} type="file" accept=".csv,.zip,text/csv,application/zip" hidden
        onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
    </>
  );
}
