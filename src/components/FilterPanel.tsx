import { useMemo } from "react";
import { DEFAULT_FILTERS, leagueName, patchKey, type Filters, type SideFilter, type StageFilter } from "../filters";
import { TIERS, type DataIndex, type Tier } from "../types";

interface Props {
  index: DataIndex;
  filters: Filters;
  onChange: (f: Filters) => void;
  teams: { team: string; games: number }[];
}

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

function Chip(p: { on: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button type="button" className={`chip${p.on ? " on" : ""}`} aria-pressed={p.on} onClick={p.onClick} title={p.title}>
      {p.children}
    </button>
  );
}

function Segmented<T extends string>(p: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={p.label}>
      {p.options.map(([v, text]) => (
        <button key={v} type="button" className={p.value === v ? "on" : ""} aria-pressed={p.value === v} onClick={() => p.onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

const addDays = (day: string, n: number) => {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function FilterPanel({ index, filters: f, onChange, teams }: Props) {
  const set = (patch: Partial<Filters>) => onChange({ ...f, ...patch });

  // Giải thuộc các tier đang chọn, gộp các năm (mùa) lại theo mã giải.
  const leagues = useMemo(() => {
    const m = new Map<string, { league: string; tier: Tier; games: number; last: string }>();
    for (const l of index.leagues) {
      if (!f.tiers.includes(l.tier)) continue;
      const e = m.get(l.league) || { league: l.league, tier: l.tier, games: 0, last: "" };
      e.games += l.games;
      if (l.lastDate > e.last) e.last = l.lastDate;
      m.set(l.league, e);
    }
    return [...m.values()].sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier) || b.games - a.games);
  }, [index, f.tiers]);

  // Phiên bản có trong các giải đang chọn, mới nhất trước.
  const patches = useMemo(() => {
    const c = new Map<string, number>();
    for (const l of index.leagues) {
      if (!f.tiers.includes(l.tier) || (f.leagues.length && !f.leagues.includes(l.league))) continue;
      for (const [p, n] of Object.entries(l.patches)) c.set(p, (c.get(p) || 0) + n);
    }
    return [...c].sort((a, b) => patchKey(b[0]) - patchKey(a[0]));
  }, [index, f.tiers, f.leagues]);

  const lastDay = useMemo(
    () => index.leagues.reduce((m, l) => (l.lastDate > m ? l.lastDate : m), "").slice(0, 10),
    [index],
  );

  const setTiers = (tiers: Tier[]) => {
    const keep = new Set(index.leagues.filter((l) => tiers.includes(l.tier)).map((l) => l.league));
    set({ tiers, leagues: f.leagues.filter((l) => keep.has(l)) });
  };

  return (
    <section className="filters" aria-label="Bộ lọc">
      <div className="row">
        <span className="lbl">Tier</span>
        <div className="chips">
          {TIERS.map((t) => (
            <Chip key={t} on={f.tiers.includes(t)} onClick={() => setTiers(toggle(f.tiers, t))}>
              Tier {t}
            </Chip>
          ))}
        </div>
      </div>

      <div className="row">
        <span className="lbl">Giải</span>
        <div className="chips">
          <Chip on={f.leagues.length === 0} onClick={() => set({ leagues: [] })}>
            Tất cả
          </Chip>
          {leagues.map((l) => (
            <Chip key={l.league} on={f.leagues.includes(l.league)} onClick={() => set({ leagues: toggle(f.leagues, l.league) })}
              title={`Tier ${l.tier} · ${l.games} game · ván cuối ${l.last.slice(0, 10)}`}>
              {leagueName(l.league)} <small>{l.games}</small>
            </Chip>
          ))}
          {leagues.length === 0 && <span className="muted">Chọn ít nhất một tier.</span>}
        </div>
      </div>

      <div className="row">
        <span className="lbl">Thời gian</span>
        <div className="chips">
          <label className="date">
            Từ <input type="date" value={f.from} max={f.to || undefined} onChange={(e) => set({ from: e.target.value })} />
          </label>
          <label className="date">
            đến <input type="date" value={f.to} min={f.from || undefined} onChange={(e) => set({ to: e.target.value })} />
          </label>
          {lastDay && (
            <>
              <Chip on={false} onClick={() => set({ from: addDays(lastDay, -30), to: "" })} title={`Tính từ ván mới nhất (${lastDay})`}>
                30 ngày
              </Chip>
              <Chip on={false} onClick={() => set({ from: addDays(lastDay, -90), to: "" })} title={`Tính từ ván mới nhất (${lastDay})`}>
                90 ngày
              </Chip>
            </>
          )}
          {(f.from || f.to) && (
            <Chip on={false} onClick={() => set({ from: "", to: "" })}>
              Bỏ chọn
            </Chip>
          )}
        </div>
      </div>

      <div className="row">
        <span className="lbl">Phiên bản</span>
        <div className="chips">
          <Chip on={f.patches.length === 0} onClick={() => set({ patches: [] })}>
            Tất cả
          </Chip>
          {patches.length > 3 && (
            <Chip on={false} onClick={() => set({ patches: patches.slice(0, 3).map((p) => p[0]) })}>
              3 bản mới nhất
            </Chip>
          )}
          {patches.map(([p, n]) => (
            <Chip key={p} on={f.patches.includes(p)} onClick={() => set({ patches: toggle(f.patches, p) })} title={`${n} game`}>
              {p}
            </Chip>
          ))}
        </div>
      </div>

      <div className="row two">
        <div className="row">
          <span className="lbl">Ván</span>
          <div className="chips">
            <Chip on={f.games.length === 0} onClick={() => set({ games: [] })}>
              Tất cả
            </Chip>
            {[1, 2, 3, 4, 5].map((n) => (
              <Chip key={n} on={f.games.includes(n)} onClick={() => set({ games: toggle(f.games, n).sort() })}>
                Ván {n}
              </Chip>
            ))}
          </div>
        </div>
        <div className="row">
          <span className="lbl">Vòng</span>
          <Segmented<StageFilter> label="Vòng đấu" value={f.stage} onChange={(stage) => set({ stage })}
            options={[["all", "Tất cả"], ["regular", "Vòng bảng"], ["playoffs", "Playoffs"]]} />
        </div>
      </div>

      <div className="row two">
        <div className="row">
          <span className="lbl">Phe</span>
          <Segmented<SideFilter> label="Phe" value={f.side} onChange={(side) => set({ side })}
            options={[["all", "Cả hai"], ["blue", "Xanh"], ["red", "Đỏ"], ["first", "Pick trước"], ["second", "Pick sau"]]} />
        </div>
        <div className="row">
          <span className="lbl">Đội</span>
          <div className="chips">
            <input className="team" list="team-list" placeholder="Gõ tên đội…" value={f.team}
              onChange={(e) => set({ team: e.target.value })} aria-label="Đội" />
            <datalist id="team-list">
              {teams.map((t) => (
                <option key={t.team} value={t.team}>{`${t.games} game`}</option>
              ))}
            </datalist>
            {f.team && (
              <Chip on={false} onClick={() => set({ team: "" })}>
                Bỏ chọn
              </Chip>
            )}
          </div>
        </div>
      </div>

      <div className="row end">
        <button type="button" className="link" onClick={() => onChange(DEFAULT_FILTERS)}>
          Đặt lại bộ lọc
        </button>
      </div>
    </section>
  );
}
