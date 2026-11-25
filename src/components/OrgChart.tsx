import type { Project } from '../types';
import type { StructureInfo } from '../lib/structure';
import { METHOD_SHORT } from '../lib/structure';
import { pct } from '../lib/util';

const W = 190,
  H = 66,
  GX = 36,
  GY = 80,
  PAD = 24;

export default function OrgChart({ project, structure, selected, onSelect }: { project: Project; structure: StructureInfo; selected: string | null; onSelect: (id: string) => void }) {
  const levels = new Map<number, string[]>();
  for (const e of project.entities) {
    const lv = structure.level[e.id] ?? -1;
    const key = lv < 0 ? 999 : lv;
    levels.set(key, [...(levels.get(key) ?? []), e.id]);
  }
  const keys = [...levels.keys()].sort((a, b) => a - b);
  // order children under their main holder to reduce crossings
  const pos = new Map<string, { x: number; y: number }>();
  const maxCols = Math.max(1, ...[...levels.values()].map((v) => v.length));
  const width = PAD * 2 + maxCols * W + (maxCols - 1) * GX;
  keys.forEach((k, row) => {
    let ids = levels.get(k)!;
    if (row > 0) {
      const xOfHolder = (id: string) => {
        const hs = project.holdings.filter((h) => h.investeeId === id && pos.has(h.holderId)).sort((a, b) => b.pct - a.pct);
        return hs.length ? pos.get(hs[0].holderId)!.x : Infinity;
      };
      ids = [...ids].sort((a, b) => xOfHolder(a) - xOfHolder(b));
    }
    const rowW = ids.length * W + (ids.length - 1) * GX;
    const x0 = (width - rowW) / 2;
    ids.forEach((id, i) => pos.set(id, { x: x0 + i * (W + GX), y: PAD + row * (H + GY) }));
  });
  const height = PAD * 2 + keys.length * H + Math.max(0, keys.length - 1) * GY;
  const ent = new Map(project.entities.map((e) => [e.id, e]));

  if (!project.entities.length) return <div className="empty">Upload reports or add entities to build the structure.</div>;

  return (
    <div className="org" style={{ height: Math.max(height, 180) }}>
      <div style={{ position: 'relative', width, height, margin: '0 auto' }}>
        <svg width={width} height={height} aria-hidden>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0L10 5L0 10z" fill="var(--muted)" />
            </marker>
          </defs>
          {project.holdings.map((h) => {
            const a = pos.get(h.holderId),
              b = pos.get(h.investeeId);
            if (!a || !b) return null;
            const x1 = a.x + W / 2,
              y1 = a.y + H,
              x2 = b.x + W / 2,
              y2 = b.y;
            const down = y2 > y1;
            const d = down ? `M${x1},${y1} C${x1},${y1 + GY / 2} ${x2},${y2 - GY / 2} ${x2},${y2}` : `M${a.x + W},${a.y + H / 2} C${a.x + W + 40},${a.y + H / 2} ${b.x + W + 40},${b.y + H / 2} ${b.x + W},${b.y + H / 2}`;
            const mx = down ? (x1 + x2) / 2 : Math.max(a.x, b.x) + W + 30,
              my = down ? (y1 + y2) / 2 : (a.y + b.y) / 2 + H / 2;
            const m = structure.method[h.investeeId];
            const sold = !!h.disposalDate && h.disposalDate <= project.periodEnd;
            const future = !!h.acqDate && h.acqDate > project.periodEnd;
            if (future) return null;
            return (
              <g key={h.id}>
                <path d={d} fill="none" stroke="var(--muted)" strokeWidth={1.5} strokeDasharray={sold ? '2 4' : m === 'equity' || m === 'investment' ? '5 4' : undefined} opacity={sold ? 0.5 : 1} markerEnd="url(#arrow)" />
                <rect x={mx - (sold ? 36 : 24)} y={my - 10} width={sold ? 72 : 48} height={20} rx={10} fill="var(--panel)" stroke="var(--border)" />
                <text x={mx} y={my + 4} textAnchor="middle" fontSize="11" fontWeight={600} fill={sold ? 'var(--muted)' : 'var(--text)'}>
                  {+h.pct.toFixed(2)}%{sold ? ' sold' : ''}
                </text>
              </g>
            );
          })}
        </svg>
        {project.entities.map((e) => {
          const p = pos.get(e.id)!;
          const m = structure.method[e.id];
          return (
            <div
              key={e.id}
              className={`org-node m-${m} ${selected === e.id ? 'selected' : ''}`}
              style={{ left: p.x, top: p.y, height: H }}
              onClick={() => onSelect(e.id)}
              title={`${e.name} — ${METHOD_SHORT[m]}`}
            >
              <div className="nm">{ent.get(e.id)!.name}</div>
              <div className="meta">
                <span>
                  {e.code} · {e.currency}
                </span>
                <span>{m === 'parent' ? '100%' : m === 'none' ? '—' : pct(m === 'full' || m === 'disposed' ? structure.effective[e.id] : structure.groupVotes[e.id])}</span>
              </div>
              <div className="meta">
                <span className={`badge m-${m}`}>{METHOD_SHORT[m]}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
