import { useEffect, useMemo, useState } from "react";
import { DraftBoard } from "./components/DraftBoard";
import { FilterPanel } from "./components/FilterPanel";
import { StatsTable } from "./components/StatsTable";
import { loadIndex, loadLeagueFile, loadMeta } from "./data";
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
  const [index, setIndex] = useState<DataIndex | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dd, setDd] = useState<DDragon | null>(null);
  const [filters, setFilters] = useState<Filters>(() => filtersFromHash(location.hash));
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadIndex().then(setIndex, (e) => setError(String(e.message || e)));
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

  // Chỉ tải các file giải cần cho bộ lọc hiện tại.
  const files = useMemo(() => (index ? filesFor(index, filters).map((l) => l.file) : []), [index, filters]);
  const filesKey = files.join("|");
  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all(files.map(loadLeagueFile)).then(
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
  }, [filesKey]);

  const teams = useMemo(() => teamsOf(games, filters), [games, filters]);
  // Đang gõ dở tên đội thì chưa lọc; khớp không phân biệt hoa thường.
  const team = useMemo(() => {
    if (!filters.team) return "";
    const t = filters.team.trim().toLowerCase();
    return teams.find((x) => x.team.toLowerCase() === t)?.team || "";
  }, [filters.team, teams]);
  const effective = useMemo(() => ({ ...filters, team }), [filters, team]);
  const summary = useMemo(() => computeStats(games, effective), [games, effective]);

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
        <p className="muted small">
          {lastGame && <>Ván mới nhất: {lastGame}</>}
          {meta?.updated && <> · Cập nhật: {meta.updated}</>}
        </p>
      </header>

      {error && <div className="alert">Lỗi: {error}</div>}
      {!index && !error && <div className="loading">Đang tải danh sách giải…</div>}

      {view === "draft" && <DraftBoard dd={dd} summary={summary} scope={scope} games={games} filters={effective} />}

      {index && view === "stats" && (
        <>
          <FilterPanel index={index} filters={filters} onChange={setFilters} teams={teams} />
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
        Dữ liệu: <a href="https://oracleselixir.com" target="_blank" rel="noreferrer">Oracle's Elixir</a>
        {", các ván mới có thể lấy từ "}
        <a href="https://lol.fandom.com" target="_blank" rel="noreferrer">Leaguepedia</a> (CC BY-SA). Ảnh tướng: Riot Data Dragon.
        Trang này không thuộc và không được Riot Games bảo trợ.
      </footer>
    </div>
  );
}
