import { useEffect, useMemo, useState } from "react";
import { champIcon, champSplash, norm, type DDragon } from "../ddragon";
import {
  act, availability, canNextGame, currentStep, DRAFT_ORDER, fearlessLocked, isDone, newSeries, nextGame,
  parseSeries, resetGame, setup, sideOf, sideOfTurn, slotsOf, teamOf, undo,
  type DraftGame, type Series, type TeamIdx,
} from "../draft";
import type { Filters } from "../filters";
import { rolesOf, type Summary } from "../stats";
import { buildModel, predictWin, suggestNext } from "../suggest";
import { ROLES, type Game, type Role, type Side } from "../types";
import { SuggestPanel } from "./SuggestPanel";

const KEY = "draft-series-v1";
const ROLE_NAMES: Record<Role, string> = { top: "Top", jng: "Rừng", mid: "Giữa", bot: "AD", sup: "Hỗ trợ" };
const SIDE_NAMES: Record<Side, string> = { blue: "Phe xanh", red: "Phe đỏ" };

function load(): Series {
  try {
    return parseSeries(localStorage.getItem(KEY)) || newSeries();
  } catch {
    return newSeries();
  }
}

function Img({ src, fallback, alt, className }: { src: string | null; fallback?: string | null; alt: string; className: string }) {
  const [step, setStep] = useState(0);
  useEffect(() => setStep(0), [src]);
  const url = step === 0 ? src : step === 1 ? fallback : null;
  if (!url) return <span className={`${className} ph`} aria-hidden="true">{alt.slice(0, 2)}</span>;
  return <img className={className} src={url} alt="" loading="lazy" onError={() => setStep((s) => s + 1)} />;
}

/** Nhãn lượt kiểu B1, R3 (phe + số thứ tự lượt trong 20 lượt). */
const stepLabel = (g: DraftGame, i: number) => `${sideOfTurn(g, DRAFT_ORDER[i].turn) === "blue" ? "B" : "R"}${i + 1}`;

function TeamColumn({ series, g, side, dd }: { series: Series; g: DraftGame; side: Side; dd: DDragon | null }) {
  const team = (sideOf(g, 0) === side ? 0 : 1) as TeamIdx;
  const s = slotsOf(g, side);
  const now = g.actions.length;
  return (
    <section className={`team-col ${side}`} aria-label={`${series.teams[team]}, ${SIDE_NAMES[side]}`}>
      <header>
        <b>{series.teams[team]}</b>
        <span className="muted small">
          {SIDE_NAMES[side]}
          {g.firstTeam === team && <span className="badge">Pick trước</span>}
        </span>
      </header>
      <div className="bans" aria-label="Cấm">
        {s.bans.map((c, i) => (
          <div key={i} className={`ban-slot${s.banSteps[i] === now ? " active" : ""}${i === 3 ? " gap" : ""}`}
            title={c ? `Cấm ${c}` : c === null ? "Bỏ lượt cấm" : `Lượt ${s.banSteps[i] + 1}`}>
            {c ? <Img className="ban-img" src={champIcon(dd, c)} alt={c} /> : c === null ? <span className="skip">–</span> : null}
          </div>
        ))}
      </div>
      <ol className="picks" aria-label="Chọn">
        {s.picks.map((c, i) => (
          <li key={i} className={`pick-slot${s.pickSteps[i] === now ? " active" : ""}${c ? " filled" : ""}`}>
            {c && <Img className="splash" src={champSplash(dd, c)} fallback={champIcon(dd, c)} alt={c} />}
            <span className="pick-label">
              <small>{stepLabel(g, s.pickSteps[i])}</small>
              <b>{c || (s.pickSteps[i] === now ? "Đang chọn…" : "")}</b>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

interface Props {
  dd: DDragon | null;
  summary: Summary;
  scope: string;
  games: Game[];
  filters: Filters;
}

export function DraftBoard({ dd, summary, scope, games, filters }: Props) {
  const [series, setSeries] = useState<Series>(load);
  const [q, setQ] = useState("");
  const [role, setRole] = useState<Role | "">("");
  const [sortBy, setSortBy] = useState<"name" | "presence">("name");
  const [hideLocked, setHideLocked] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(series));
    } catch {
      /* trình duyệt chặn lưu: bỏ qua */
    }
  }, [series]);

  const g = series.games[series.games.length - 1];
  const gameNo = series.games.length;
  const step = currentStep(g);
  const locked = useMemo(() => fearlessLocked(series), [series]);

  // Thống kê theo bộ lọc hiện tại: vai trò chính và presence của từng tướng.
  const statOf = useMemo(() => {
    const m = new Map<string, { roles: Role[]; presence: number }>();
    for (const s of summary.champions) m.set(norm(s.champion), { roles: rolesOf(s).map((x) => x.role), presence: s.presence });
    return m;
  }, [summary]);

  // Danh sách tướng: lấy từ Data Dragon, nếu chưa tải được thì lấy từ dữ liệu giải.
  const pool = useMemo(() => {
    if (dd?.champions.length) return dd.champions.map((c) => c.name);
    return summary.champions.map((c) => c.champion).sort((a, b) => a.localeCompare(b));
  }, [dd, summary]);

  // Gợi ý cho lượt hiện tại và lượt kế tiếp, theo cùng bộ lọc với tab Thống kê.
  const model = useMemo(() => buildModel(games, filters), [games, filters]);
  const [lane, setLane] = useState<Role | null>(null);
  const suggestions = useMemo(() => suggestNext(model, series, pool, 5, lane), [model, series, pool, lane]);
  const win = useMemo(() => predictWin(model, series.games[series.games.length - 1]), [model, series]);

  const list = useMemo(() => {
    const qq = norm(q);
    const rows = pool
      .filter((c) => !qq || norm(c).includes(qq))
      // Tướng đa vai trò hiện ở mọi vai trò nó đi từ 15% số lần pick trở lên.
      .filter((c) => !role || statOf.get(norm(c))?.roles.includes(role))
      .map((c) => ({ name: c, av: availability(series, c), presence: statOf.get(norm(c))?.presence || 0 }))
      .filter((r) => !hideLocked || r.av.ok);
    if (sortBy === "presence") rows.sort((a, b) => b.presence - a.presence || a.name.localeCompare(b.name));
    return rows;
  }, [pool, q, role, statOf, series, hideLocked, sortBy]);

  const choose = (c: string | null) => {
    setSeries((s) => act(s, c));
    setQ("");
  };

  const turnTeam = step ? teamOf(g, step.turn) : null;
  const turnSide = step ? sideOfTurn(g, step.turn) : null;
  const n = summary.games;
  const setupLocked = g.actions.length > 0;
  const seg = (value: TeamIdx, on: (t: TeamIdx) => void, label: string) => (
    <div className="seg" role="group" aria-label={label}>
      {([0, 1] as TeamIdx[]).map((t) => (
        <button key={t} type="button" className={value === t ? "on" : ""} aria-pressed={value === t}
          disabled={setupLocked} onClick={() => on(t)}>
          {series.teams[t]}
        </button>
      ))}
    </div>
  );

  return (
    <div className="draft">
      <section className="draft-setup">
        <div className="row-wrap">
          <label className="field">
            <span className="lbl">Đội 1</span>
            <input value={series.teams[0]} maxLength={24}
              onChange={(e) => setSeries((s) => ({ ...s, teams: [e.target.value, s.teams[1]] }))} />
          </label>
          <label className="field">
            <span className="lbl">Đội 2</span>
            <input value={series.teams[1]} maxLength={24}
              onChange={(e) => setSeries((s) => ({ ...s, teams: [s.teams[0], e.target.value] }))} />
          </label>
          <label className="field">
            <span className="lbl">Thể thức</span>
            <select value={series.bestOf}
              onChange={(e) => {
                const bestOf = Number(e.target.value) as Series["bestOf"];
                setSeries((s) => (s.games.length > bestOf ? s : { ...s, bestOf }));
              }}>
              {[1, 3, 5].map((b) => (
                <option key={b} value={b} disabled={series.games.length > b}>Bo{b}</option>
              ))}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={series.fearless}
              onChange={(e) => setSeries((s) => ({ ...s, fearless: e.target.checked }))} />
            Fearless
          </label>
          <button type="button" className="btn"
            onClick={() => {
              if (series.games.length === 1 && !g.actions.length) return;
              if (confirm("Xóa toàn bộ series hiện tại và bắt đầu lại?")) setSeries((s) => newSeries(s));
            }}>
            Series mới
          </button>
        </div>
        <div className="row-wrap">
          <span className="game-no">Ván {gameNo}/{series.bestOf}</span>
          <span className="field"><span className="lbl">Phe xanh</span>{seg(g.blueTeam, (t) => setSeries((s) => setup(s, { blueTeam: t })), "Đội ở phe xanh")}</span>
          <span className="field"><span className="lbl">Pick trước</span>{seg(g.firstTeam, (t) => setSeries((s) => setup(s, { firstTeam: t })), "Đội pick trước")}</span>
          {setupLocked && <span className="muted small">Đổi phe và quyền pick trước khi ván chưa bắt đầu (hoặc làm lại ván).</span>}
        </div>
      </section>

      <div className={`turn-bar ${turnSide || ""}`} aria-live="polite">
        <div>
          {step && turnTeam !== null && turnSide ? (
            <>
              <b>Lượt {g.actions.length + 1}/20</b> · {step.kind === "ban" ? `Cấm ${step.phase}` : `Chọn ${step.phase}`} ·{" "}
              <span className={turnSide}>{series.teams[turnTeam]} ({SIDE_NAMES[turnSide].toLowerCase()})</span>{" "}
              {step.kind === "ban" ? "cấm" : "chọn"}
            </>
          ) : (
            <b>Ván {gameNo} đã draft xong.</b>
          )}
        </div>
        <div className="actions">
          {step?.kind === "ban" && <button type="button" className="btn" onClick={() => choose(null)}>Bỏ lượt cấm</button>}
          <button type="button" className="btn" onClick={() => setSeries(undo)}
            disabled={!g.actions.length && series.games.length === 1}>
            Hoàn tác
          </button>
          <button type="button" className="btn" onClick={() => setSeries(resetGame)} disabled={!g.actions.length}>Làm lại ván</button>
          {isDone(g) && (
            <button type="button" className="btn primary" onClick={() => setSeries(nextGame)} disabled={!canNextGame(series)}>
              {canNextGame(series) ? `Sang ván ${gameNo + 1}` : "Hết series"}
            </button>
          )}
        </div>
      </div>

      <SuggestPanel dd={dd} series={series} steps={suggestions} samples={summary.games} onChoose={(c) => choose(c)}
        lane={lane} onLane={setLane} win={win} />

      <div className="draft-board">
        <TeamColumn series={series} g={g} side="blue" dd={dd} />

        <section className="pool" aria-label="Chọn tướng">
          <div className="toolbar">
            <input type="search" placeholder="Tìm tướng… (Enter để chọn)" value={q} aria-label="Tìm tướng"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                const first = list.find((r) => r.av.ok);
                if (first && step) choose(first.name);
              }} />
            <div className="seg" role="group" aria-label="Vai trò">
              <button type="button" className={role === "" ? "on" : ""} onClick={() => setRole("")}>Tất cả</button>
              {ROLES.map((r) => (
                <button key={r} type="button" className={role === r ? "on" : ""} aria-pressed={role === r}
                  onClick={() => setRole(role === r ? "" : r)}>
                  {ROLE_NAMES[r]}
                </button>
              ))}
            </div>
            <label>
              Xếp theo{" "}
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as "name" | "presence")}>
                <option value="name">Tên</option>
                <option value="presence">Presence</option>
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={hideLocked} onChange={(e) => setHideLocked(e.target.checked)} />
              Ẩn tướng đã dùng
            </label>
          </div>
          <p className="muted small pool-note">
            Vai trò và presence lấy từ {n} ván theo bộ lọc ở tab Thống kê ({scope}).
            {series.fearless && locked.size > 0 && ` Fearless: ${locked.size} tướng đã pick ở ván trước bị khóa.`}
          </p>
          <div className="champ-grid">
            {list.map(({ name, av, presence }) => {
              const why = av.ok ? "" : av.reason === "fearless" ? `Đã pick ở ván ${av.game}` : "Đã dùng trong ván này";
              return (
                <button key={name} type="button" className={`champ${av.ok ? "" : ` off ${av.reason}`}`}
                  disabled={!av.ok || !step} onClick={() => choose(name)}
                  title={[name, why, n ? `Presence ${((100 * presence) / n).toFixed(0)}%` : ""].filter(Boolean).join(" · ")}>
                  <Img className="champ-img" src={champIcon(dd, name)} alt={name} />
                  <span className="champ-name">{name}</span>
                  {!av.ok && av.reason === "fearless" && <span className="lock">V{av.game}</span>}
                </button>
              );
            })}
            {list.length === 0 && <p className="empty">Không có tướng nào khớp.</p>}
          </div>
        </section>

        <TeamColumn series={series} g={g} side="red" dd={dd} />
      </div>

      {series.games.length > 1 && (
        <section className="history">
          <h2>Các ván trong series</h2>
          {series.games.slice(0, -1).map((game, gi) => (
            <div key={gi} className="history-row">
              <span className="game-no">Ván {gi + 1}</span>
              {(["blue", "red"] as Side[]).map((side) => {
                const team = (sideOf(game, 0) === side ? 0 : 1) as TeamIdx;
                return (
                  <span key={side} className={`history-team ${side}`}>
                    <b>{series.teams[team]}</b>
                    {slotsOf(game, side).picks.map((c, i) =>
                      c ? <Img key={i} className="mini" src={champIcon(dd, c)} alt={c} /> : null,
                    )}
                  </span>
                );
              })}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
