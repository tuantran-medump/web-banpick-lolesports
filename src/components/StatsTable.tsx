import { useMemo, useState } from "react";
import { champIcon, norm, type DDragon } from "../ddragon";
import { rolesOf, type ChampStat, type Summary } from "../stats";
import type { Role } from "../types";

const ROLE_NAMES: Record<Role, string> = { top: "Top", jng: "Rừng", mid: "Giữa", bot: "AD", sup: "Hỗ trợ" };

type Key = "champion" | "presence" | "picks" | "bans" | "winrate" | "blue" | "firstPicks" | "bannedAgainst";

const pct = (a: number, b: number) => (b ? (100 * a) / b : 0);
const fmt = (v: number) => `${v.toFixed(1)}%`;

function Icon({ dd, name }: { dd: DDragon | null; name: string }) {
  const [broken, setBroken] = useState(false);
  const src = champIcon(dd, name);
  if (!src || broken) {
    return <span className="icon ph" aria-hidden="true">{name.slice(0, 2)}</span>;
  }
  return <img className="icon" src={src} alt="" loading="lazy" width={32} height={32} onError={() => setBroken(true)} />;
}

function Bar({ value }: { value: number }) {
  return (
    <span className="bar" aria-hidden="true">
      <span style={{ width: `${Math.min(100, value)}%` }} />
    </span>
  );
}

export function StatsTable({ summary, dd }: { summary: Summary; dd: DDragon | null }) {
  const [sort, setSort] = useState<{ key: Key; desc: boolean }>({ key: "presence", desc: true });
  const [q, setQ] = useState("");
  const [minPicks, setMinPicks] = useState(0);
  const n = summary.games;

  const value = (s: ChampStat, k: Key): number | string => {
    switch (k) {
      case "champion": return s.champion;
      case "winrate": return s.picks ? s.wins / s.picks + s.picks * 1e-9 : -1; // bằng nhau thì nhiều game hơn lên trước
      case "blue": return s.picks ? s.bluePicks / s.picks : -1;
      default: return s[k];
    }
  };

  const rows = useMemo(() => {
    const qq = norm(q);
    const list = summary.champions.filter((s) => (!qq || norm(s.champion).includes(qq)) && s.picks >= minPicks);
    const dir = sort.desc ? -1 : 1;
    return list.sort((a, b) => {
      const va = value(a, sort.key), vb = value(b, sort.key);
      const c = typeof va === "string" ? va.localeCompare(vb as string) : va - (vb as number);
      return c * dir || b.presence - a.presence || a.champion.localeCompare(b.champion);
    });
  }, [summary, sort, q, minPicks]);

  const th = (k: Key, label: string, title?: string) => (
    <th scope="col" title={title} aria-sort={sort.key === k ? (sort.desc ? "descending" : "ascending") : "none"}>
      <button type="button" onClick={() => setSort((s) => ({ key: k, desc: s.key === k ? !s.desc : k !== "champion" }))}>
        {label}
        <span className="arrow">{sort.key === k ? (sort.desc ? "▼" : "▲") : ""}</span>
      </button>
    </th>
  );

  const unit = "ván";

  return (
    <section className="stats">
      <div className="toolbar">
        <input type="search" placeholder="Tìm tướng…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm tướng" />
        <label>
          Pick tối thiểu{" "}
          <select value={minPicks} onChange={(e) => setMinPicks(Number(e.target.value))}>
            {[0, 1, 3, 5, 10, 20].map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </label>
        <span className="muted">{rows.length} tướng</span>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col" className="num">#</th>
              {th("champion", "Tướng")}
              <th scope="col">Vai trò</th>
              {th("presence", "Presence", `Số ${unit} tướng được pick hoặc ban / tổng số ${unit}`)}
              {th("picks", "Pick", `Số lần pick, tỉ lệ trên tổng số ${unit}`)}
              {th("bans", "Ban", `Số lần ban, tỉ lệ trên tổng số ${unit}`)}
              {th("winrate", "Tỉ lệ thắng", "Số ván thắng / số lần pick")}
              {th("blue", "Xanh / Đỏ", "Số lần pick ở phe xanh và phe đỏ")}
              {th("firstPicks", "Pick đầu", "Số lần là lượt pick đầu tiên của ván")}
              {summary.perspective && th("bannedAgainst", "Bị cấm", "Số lần đối thủ cấm tướng này")}
            </tr>
          </thead>
          <tbody>
            {rows.map((s, i) => {
              const roles = rolesOf(s);
              const wr = pct(s.wins, s.picks);
              return (
                <tr key={s.champion}>
                  <td className="num muted">{i + 1}</td>
                  <th scope="row" className="champ-cell">
                    <span className="champ-label">
                      <Icon dd={dd} name={s.champion} />
                      <span>{s.champion}</span>
                    </span>
                  </th>
                  <td className="muted roles-cell"
                    title={roles.length > 1 ? roles.map((x) => `${ROLE_NAMES[x.role]} ${(100 * x.share).toFixed(0)}%`).join(", ") : undefined}>
                    {roles.length ? roles.map((x, j) => (
                      <span key={x.role} className={j ? "alt-role" : ""}>
                        {j > 0 && " · "}{ROLE_NAMES[x.role]}{roles.length > 1 && <small> {(100 * x.share).toFixed(0)}%</small>}
                      </span>
                    )) : "–"}
                  </td>
                  <td className="metric">
                    <span className="v">{fmt(pct(s.presence, n))}</span>
                    <Bar value={pct(s.presence, n)} />
                  </td>
                  <td className="metric">
                    <span className="v">{s.picks}</span>
                    <span className="sub">{fmt(pct(s.picks, n))}</span>
                  </td>
                  <td className="metric">
                    <span className="v">{s.bans}</span>
                    <span className="sub">{fmt(pct(s.bans, n))}</span>
                  </td>
                  <td className={`metric ${s.picks < 5 ? "low" : wr >= 55 ? "good" : wr <= 45 ? "bad" : ""}`}
                    title={s.picks < 5 ? "Ít hơn 5 lần pick, chưa đủ để kết luận" : undefined}>
                    <span className="v">{s.picks ? fmt(wr) : "–"}</span>
                    <span className="sub">{s.wins}–{s.picks - s.wins}</span>
                  </td>
                  <td className="metric">
                    <span className="v">
                      <span className="blue">{s.bluePicks}</span> / <span className="red">{s.redPicks}</span>
                    </span>
                  </td>
                  <td className="metric"><span className="v">{s.firstPicks || "–"}</span></td>
                  {summary.perspective && (
                    <td className="metric">
                      <span className="v">{s.bannedAgainst}</span>
                      <span className="sub">{fmt(pct(s.bannedAgainst, n))}</span>
                    </td>
                  )}
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="empty">Không có tướng nào khớp bộ lọc.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
