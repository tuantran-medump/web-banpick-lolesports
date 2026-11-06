// Giao diện sáng/tối: mặc định theo máy, người xem có thể chọn cố định. Lưu trong trình duyệt.

import { useEffect, useState } from "react";

export type Theme = "auto" | "light" | "dark";
const KEY = "theme";
export const THEMES: Theme[] = ["auto", "light", "dark"];
export const THEME_NAMES: Record<Theme, string> = { auto: "Theo máy", light: "Sáng", dark: "Tối" };

export function readTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY) as Theme;
    return THEMES.includes(t) ? t : "auto";
  } catch {
    return "auto";
  }
}

export function applyTheme(t: Theme) {
  if (t === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    applyTheme(theme);
    try {
      if (theme === "auto") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, theme);
    } catch {
      /* bỏ qua */
    }
  }, [theme]);
  return [theme, setTheme];
}

/** true khi màn hình hẹp (điện thoại). */
export function useNarrow(maxWidth = 760): boolean {
  const q = `(max-width: ${maxWidth}px)`;
  const [narrow, setNarrow] = useState(() => typeof matchMedia !== "undefined" && matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const on = () => setNarrow(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [q]);
  return narrow;
}
