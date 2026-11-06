import { useState } from "react";
import { champIcon, type DDragon } from "../ddragon";
import type { Series } from "../draft";
import type { StepSuggestions, WinPrediction } from "../suggest";
import { useNarrow } from "../theme";
import { ROLES, type Role, type Side } from "../types";
import { sideOf, type TeamIdx } from "../draft";

const ROLE_NAMES: Record<Role, string> = { top: "Top", jng: "Rừng", mid: "Giữa", bot: "AD", sup: "Hỗ trợ" };
const HIDE_KEY = "draft-suggest-hidden";
const SIDE_NAMES: Record<Side, string> = { blue: "phe xanh", red: "phe đỏ" };

interface Props {
  dd: DDragon | null;
  series: Series;
  steps: StepSuggestions[];
  samples: number;
  onChoose: (champion: string) => void;
  lane: Role | null;
  onLane: (lane: Role | null) => void;
  win: WinPrediction | null;
}

const signedPct = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(100 * x).toFixed(1)}%`;

/** Thanh % thắng của hai đội theo các tướng đã pick. */
function WinBar({ series, win }: { series: Series; win: WinPrediction }) {
  const g = series.games[series.games.length - 1];
  const name = (side: Side) => series.teams[(sideOf(g, 0) === side ? 0 : 1) as TeamIdx];
  const b = Math.round(100 * win.blue);
  return (
    <div className="win">
      <div className="win-head">
        <b>% thắng dự đoán</b>
        <span className="muted small">
          {win.picks < 10 ? `Tạm tính với ${win.picks}/10 tướng đã pick` : "Đã pick đủ 10 tướng"}.
          {" "}Chỉ tính từ draft, chưa tính trình độ đội: thử trên các ván Tier 1 2026 thì đoán đúng khoảng 56–58% số ván.
        </span>
      </div>
      <div className="win-bar" role="img" aria-label={`${name("blue")} ${b}%, ${name("red")} ${100 - b}%`}>
        <span className="wb blue" style={{ width: `${b}%` }}>{name("blue")} {b}%</span>
        <span className="wb red" style={{ width: `${100 - b}%` }}>{100 - b}% {name("red")}</span>
      </div>
      <ul className="win-parts small">
        {win.parts.filter((p) => Math.abs(p.blue) >= 0.001).map((p) => (
          <li key={p.label} title={p.detail}>
            {p.label}: <b className={p.blue >= 0 ? "blue" : "red"}>{signedPct(p.blue)} cho {p.blue >= 0 ? name("blue") : name("red")}</b>
            {p.detail && <span className="muted"> ({p.detail})</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Gợi ý cho lượt hiện tại và lượt kế tiếp, mỗi tướng kèm lý do. */
export function SuggestPanel({ dd, series, steps, samples, onChoose, lane, onLane, win }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  // Điện thoại: mỗi tướng chỉ hiện 1 lý do, bấm để xem thêm.
  const keep = useNarrow() ? 1 : 2;
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(HIDE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggle = () => {
    setHidden(!hidden);
    try {
      localStorage.setItem(HIDE_KEY, hidden ? "0" : "1");
    } catch {
      /* trình duyệt chặn lưu: bỏ qua */
    }
  };
  if (!steps.length && !win) return null;
  return (
    <section className="suggest" aria-label="Gợi ý ban/pick">
      <div className="suggest-head">
        <b>Gợi ý</b>
        <span className="muted small">
          Từ {samples} ván theo bộ lọc ở tab Thống kê. Điểm gồm presence, tỉ lệ thắng, hợp với tướng đồng đội, đối đầu tướng
          đã pick, kèo còn lại có thể pick/counter và thói quen theo lượt, theo ván.
        </span>
        <button type="button" className="btn" onClick={toggle} aria-expanded={!hidden}>{hidden ? "Hiện gợi ý" : "Ẩn"}</button>
      </div>
      {!hidden && win && <WinBar series={series} win={win} />}
      {!hidden && steps.length > 0 && (
        <div className="seg lane-seg" role="group" aria-label="Gợi ý theo lane">
          <button type="button" className={lane === null ? "on" : ""} aria-pressed={lane === null} onClick={() => onLane(null)}>Chung</button>
          {ROLES.map((r) => (
            <button key={r} type="button" className={lane === r ? "on" : ""} aria-pressed={lane === r} onClick={() => onLane(lane === r ? null : r)}>
              {ROLE_NAMES[r]}
            </button>
          ))}
        </div>
      )}
      {!hidden && <div className="suggest-cols">
        {steps.map((st, si) => (
          <div key={st.index} className={`suggest-col sc-${st.side}`}>
            <div className="suggest-title">
              <b>Lượt {st.index + 1}</b> · <span className={st.side}>{series.teams[st.team]} ({SIDE_NAMES[st.side]})</span> {st.step.kind === "ban" ? "cấm" : "chọn"}
              {st.assumed && <span className="muted small"> · nếu lượt trước lấy {st.assumed}</span>}
            </div>
            {st.unsure.length > 0 && (
              <p className="muted small flex-note">
                Chưa chốt đường:{" "}
                {st.unsure.map((u) => `${u.champion} của ${series.teams[u.team]} (${u.roles.map((r) => `${ROLE_NAMES[r.role]} ${(100 * r.p).toFixed(0)}%`).join(" / ")})`).join("; ")}.
                Vai trò còn trống và đối đầu cùng đường được tính theo các khả năng này.
              </p>
            )}
            {st.lane && st.laneOpen !== null && st.laneOpen < 0.5 && (
              <p className="muted small flex-note">
                {st.step.kind === "pick" ? series.teams[st.team] : "Đối thủ"} gần như đã có tướng ở đường {ROLE_NAMES[st.lane]}
                {" "}(còn trống {(100 * st.laneOpen).toFixed(0)}%), nên các gợi ý dưới đây bị trừ điểm vai trò.
              </p>
            )}
            {st.items.length === 0 && <p className="muted small">Chưa đủ dữ liệu để gợi ý.</p>}
            <ol className="suggest-list">
              {st.items.map((x, i) => {
                const key = `${st.index}|${x.champion}`;
                const shown = open === key ? x.reasons : x.reasons.slice(0, keep);
                return (
                  <li key={x.champion} className="suggest-item">
                    <button type="button" className="suggest-pick" disabled={si > 0}
                      title={si > 0 ? "Gợi ý cho lượt sau" : `Chọn ${x.champion}`} onClick={() => onChoose(x.champion)}>
                      <span className="rank">{i + 1}</span>
                      {champIcon(dd, x.champion)
                        ? <img className="suggest-img" src={champIcon(dd, x.champion)!} alt="" loading="lazy" />
                        : <span className="suggest-img ph" aria-hidden="true">{x.champion.slice(0, 2)}</span>}
                      <span className="suggest-name">
                        <b>{x.champion}</b>
                        <small className="muted">
                          {x.roles.length > 0 && (st.step.kind === "pick" ? "" : "chặn ")}
                          {x.roles.length === 1 ? ROLE_NAMES[x.roles[0].role]
                            : x.roles.map((r) => `${ROLE_NAMES[r.role]} ${(100 * r.p).toFixed(0)}%`).join(" / ")}
                          {x.roles.length > 0 && " · "}{x.score.toFixed(0)} điểm
                        </small>
                      </span>
                    </button>
                    <ul className="reasons">
                      {shown.map((r, j) => (
                        <li key={j} className={r.info ? "info" : r.points >= 0 ? "up" : "down"}>{r.text}</li>
                      ))}
                    </ul>
                    {x.reasons.length > keep && (
                      <button type="button" className="more-link small" onClick={() => setOpen(open === key ? null : key)}>
                        {open === key ? "Thu gọn" : `+${x.reasons.length - keep} lý do`}
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>}
    </section>
  );
}
