import { Glyph } from './glyph';
import type { CoverageRow } from '@/lib/api';

export function CoverageTable({ rows }: { rows: CoverageRow[] }) {
  const gaps = rows.filter((r) => r.gap > 0);
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-y-[3px] text-sm">
          <caption className="nc-sr">Approved questions against the blueprint target, by topic</caption>
          <thead>
            <tr className="text-left text-[13px] text-ink-muted">
              <th scope="col" className="px-3 py-1 font-semibold">Topic</th>
              <th scope="col" className="px-3 py-1 font-semibold">Approved / target</th>
              <th scope="col" className="px-3 py-1 font-semibold">Easy · Mod. · Hard</th>
              <th scope="col" className="px-3 py-1 font-semibold">Pending</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const met = r.gap === 0;
              return (
                <tr key={r.topic}>
                  <th scope="row" className="rounded-l-sm px-3 py-2 text-left font-semibold">{r.topic}</th>
                  <td className="px-3 py-2">
                    <span
                      className="inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 font-[650] tabular-nums"
                      style={met ? { color: 'var(--approved)', background: 'var(--approved-soft)' } : { color: 'var(--caution)', background: 'var(--caution-soft)', boxShadow: 'inset 0 0 0 1.5px var(--caution)' }}
                    >
                      <Glyph name={met ? 'check' : 'warn'} />
                      {r.approved} / {r.target}
                    </span>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{r.byDifficulty.easy} · {r.byDifficulty.medium} · {r.byDifficulty.hard}</td>
                  <td className="rounded-r-sm px-3 py-2 tabular-nums">{r.pending}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {gaps.length ? (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-sm font-semibold text-caution">
          {gaps.map((g) => (
            <li key={g.topic} className="flex items-center gap-1.5">
              <Glyph name="warn" />
              {g.topic}: need {g.target}, have {g.approved}
            </li>
          ))}
        </ul>
      ) : rows.length ? (
        <p className="m-0 flex items-center gap-1.5 text-sm font-semibold text-approved"><Glyph name="check" />Every topic meets the blueprint</p>
      ) : null}
    </div>
  );
}
