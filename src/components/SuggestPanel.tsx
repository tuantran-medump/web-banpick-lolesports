import { useState } from "react";
import { champIcon, type DDragon } from "../ddragon";
import type { Series } from "../draft";
import type { StepSuggestions } from "../suggest";
import { useNarrow } from "../theme";
import type { Role, Side } from "../types";

const ROLE_NAMES: Record<Role, string> = { top: "Top", jng: "Rừng", mid: "Giữa", bot: "AD", sup: "Hỗ trợ" };
const HIDE_KEY = "draft-suggest-hidden";
const SIDE_NAMES: Record<Side, string> = { blue: "phe xanh", red: "phe đỏ" };

interface Props {
  dd: DDragon | null;
  series: Series;
  steps: StepSuggestions[];
  samples: number;
  onChoose: (champion: string) => void;
}

/** Gợi ý cho lượt hiện tại và lượt kế tiếp, mỗi tướng kèm lý do. */
export function SuggestPanel({ dd, series, steps, samples, onChoose }: Props) {
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
  if (!steps.length) return null;
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
