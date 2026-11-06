// Đọc CSV trong luồng riêng để trang không bị đứng khi file lớn.
import { readOeFile } from "./oe";

self.onmessage = async (e: MessageEvent<File>) => {
  try {
    const r = await readOeFile(e.data, (p) => self.postMessage({ type: "progress", ...p }));
    self.postMessage({ type: "done", ...r });
  } catch (err) {
    self.postMessage({ type: "error", message: String((err as Error).message || err) });
  }
};
