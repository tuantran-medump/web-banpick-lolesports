import { useEffect, useMemo, useState } from "react";
import { DraftBoard } from "./components/DraftBoard";
import { FilterPanel } from "./components/FilterPanel";
import { StatsTable } from "./components/StatsTable";
import { UpdateButton } from "./components/UpdateButton";
import { loadIndex, loadLeagueFile, loadMeta } from "./data";
import { mergeLocal } from "./local";
import { deleteLocalGames, getLocalGames } from "./localdb";
import { THEME_NAMES, THEMES, useNarrow, useTheme } from "./theme";
import { loadDDragon, type DDragon } from "./ddragon";
import { filesFor, filtersFromHash, filtersToHash, leagueName, type Filters } from "./filters";
import { computeStats, teamsOf } from "./stats";
import type { DataIndex, Game, Meta } from "./types";

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : "–");

const SIDE_TEXT: Record<Filters["side"], string> = {
  all: "", blue: "phe xanh", red: "phe đỏ", first: "đội pick trước", second: "đội pick sau",
};

type View = "stats" | "draft";
const viewFromHash = (h: string): View => (new URLSearchParams(h.replace(/^#/, "")).get("view") === "draft" ? "draft" : "stats");

export default function App() {
  const [view, setView] = useState<View>(() => viewFromHash(location.hash));
  const [snapshot, setSnapshot] = useState<DataIndex | null>(null);
  const [local, setLocal] = useState<Game[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dd, setDd] = useState<DDragon | null>(null);
  const [filters, setFilters] = useState<Filters>(() => filtersFromHash(location.hash));
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(false);
  const [theme, setTheme] = useTheme();
  const narrow = useNarrow();
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    loadIndex().then(setSnapshot, (e) => setError(String(e.message || e)));
    getLocalGames().then(setLocal);
    loadMeta().then(setMeta);
    loadDDragon().then(setDd);
    const onHash = () => {
      setFilters(filtersFromHash(location.hash));
      setView(viewFromHash(location.hash));
    };
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  // Ghi bộ lọc và tab đang mở lên URL để chia sẻ được.
  useEffect(() => {
    const h = [filtersToHash(filters), view === "draft" ? "view=draft" : ""].filter(Boolean).join("&");
    if (h !== location.hash.replace(/^#/, "")) history.replaceState(null, "", h ? `#${h}` : location.pathname);
  }, [filters, view]);

  // Ván lấy bằng nút Cập nhật (trong trình duyệt) gộp vào dữ liệu của web.
  const merged = useMemo(() => (snapshot ? mergeLocal(snapshot, local) : null), [snapshot, local]);
  const index = merged?.index ?? null;
  // Web đã có các ván này (dữ liệu được cập nhật sau lần bấm): xóa bản trong trình duyệt.
  useEffect(() => {
    if (merged?.stale.length) deleteLocalGames(merged.stale).catch(() => {});
  }, [merged]);

  // Chỉ tải các file giải cần cho bộ lọc hiện tại.
  const files = useMemo(() => (index ? filesFor(index, filters).map((l) => l.file) : []), [index, filters]);
  const filesKey = files.join("|");
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const inSnapshot = new Set(snapshot?.leagues.map((l) => l.file));
    const part = (f: string) =>
      (inSnapshot.has(f) ? loadLeagueFile(f) : Promise.resolve([] as Game[])).then((gs) => {
        const extra = merged?.byFile.get(f);
        if (!extra?.length) return gs;
        const ids = new Set(gs.map((g) => g.id));
        return [...gs, ...extra.filter((g) => !ids.has(g.id))];
      });
    Promise.all(files.map(part)).then(
      (parts) => {
        if (!alive) return;
        setGames(parts.flat());
        setLoading(false);
      },
      (e) => {
        if (!alive) return;
        setError(String(e.message || e));
        setLoading(false);
      },
    );
    return () => {
      alive = false;
    };
  }, [filesKey, merged]); // eslint-disable-line react-hooks/exhaustive-deps

  const teams = useMemo(() => teamsOf(games, filters), [games, filters]);
  // Đang gõ dở tên đội thì chưa lọc; khớp không phân biệt hoa thường.
  const team = useMemo(() => {
    if (!filters.team) return "";
    const t = filters.team.trim().toLowerCase();
    return teams.find((x) => x.team.toLowerCase() === t)?.team || "";
  }, [filters.team, teams]);
  const effective = useMemo(() => ({ ...filters, team }), [filters, team]);
  const summary = useMemo(() => computeStats(games, effective), [games, effective]);

  const localShown = merged ? [...merged.byFile.values()].reduce((n, gs) => n + gs.length, 0) : 0;
  const lastGame = index?.leagues.reduce((m, l) => (l.lastDate > m ? l.lastDate : m), "").slice(0, 10);
  const scope = [
    filters.leagues.length ? filters.leagues.map(leagueName).join(", ") : `Tier ${filters.tiers.join(", ")}`,
    team, SIDE_TEXT[filters.side],
  ].filter(Boolean).join(" · ");

  return (
    <div className="app">
      <header>
        <div>
          <h1>Banpick LoL</h1>
          <p className="muted">Thống kê ban/pick tướng ở các giải chuyên nghiệp</p>
        </div>
        <nav className="tabs" aria-label="Chế độ">
          <button type="button" className={view === "stats" ? "on" : ""} aria-pressed={view === "stats"} onClick={() => setView("stats")}>
            Thống kê
          </button>
          <button type="button" className={view === "draft" ? "on" : ""} aria-pressed={view === "draft"} onClick={() => setView("draft")}>
            Bàn draft
          </button>
        </nav>
        <div className="header-side">
          <p className="muted small">
            {lastGame && <>Ván mới nhất: {lastGame}</>}
            {meta?.updated && <> · Dữ liệu web: {meta.updated}</>}
          </p>
          <UpdateButton snapshot={snapshot} local={local} localShown={localShown} onLocal={setLocal} />
        </div>
        <label className="theme-pick small">
          <span className="muted">Giao diện</span>
          <select value={theme} onChange={(e) => setTheme(e.target.value as typeof theme)}>
            {THEMES.map((t) => (
              <option key={t} value={t}>{THEME_NAMES[t]}</option>
            ))}
          </select>
        </label>
      </header>

      {error && <div className="alert">Lỗi: {error}</div>}
      {!index && !error && <div className="loading">Đang tải danh sách giải…</div>}

      {view === "draft" && <DraftBoard dd={dd} summary={summary} scope={scope} games={games} filters={effective} />}

      {index && view === "stats" && (
        <>
          {narrow && (
            <button type="button" className="btn filters-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>
              {filtersOpen ? "Ẩn bộ lọc" : "Bộ lọc"} <span className="muted">· {scope}</span>
            </button>
          )}
          {(!narrow || filtersOpen) && <FilterPanel index={index} filters={filters} onChange={setFilters} teams={teams} />}
          {filters.team && !team && (
            <div className="hint">Không thấy đội “{filters.team}” trong các ván đang lọc. Chọn tên trong danh sách gợi ý.</div>
          )}

          <section className="summary" aria-live="polite">
            <div className="scope">{scope}</div>
            <div className="cards">
              <div className="card">
                <b>{summary.games}</b>
                <span>ván</span>
              </div>
              <div className="card">
                <b>{summary.series}</b>
                <span>series</span>
              </div>
              {summary.perspective ? (
                <div className="card">
                  <b>{pct(summary.wins, summary.games)}</b>
                  <span>tỉ lệ thắng ({summary.wins}–{summary.games - summary.wins})</span>
                </div>
              ) : (
                <div className="card">
                  <b>{pct(summary.blueWins, summary.decided)}</b>
                  <span>phe xanh thắng</span>
                </div>
              )}
              <div className="card">
                <b>{summary.champions.length}</b>
                <span>tướng xuất hiện</span>
              </div>
            </div>
            {loading && <div className="loading">Đang tải dữ liệu giải…</div>}
          </section>

          <StatsTable summary={summary} dd={dd} />
        </>
      )}

      <footer className="muted small">
        <p>
          Dữ liệu trận đấu: <a href="https://oracleselixir.com" target="_blank" rel="noreferrer">Oracle's Elixir</a> (Tim Sevenhuysen).
          {" "}Các ván mới hơn lấy từ <a href="https://lol.fandom.com" target="_blank" rel="noreferrer">Leaguepedia</a>,
          {" "}giấy phép <a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noreferrer">CC BY-SA 3.0</a>,
          {" "}đã đổi sang định dạng của web. Ảnh tướng:{" "}
          <a href="https://developer.riotgames.com/docs/lol#data-dragon" target="_blank" rel="noreferrer">Data Dragon</a> của Riot Games.
        </p>
        <p>
          Banpick LoL isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially
          involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or
          registered trademarks of Riot Games, Inc.
        </p>
      </footer>
    </div>
  );
}
