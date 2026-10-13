// One React component per Board Script shape kind, drawn with rough.js strokes.
import { memo, useEffect, useMemo, useState, type CSSProperties } from 'react';
import katex from 'katex';
import hljs from 'highlight.js/lib/common';
import type { ShapeStyle } from '@chalk/schema';
import { arrowGeometry, tableColumnWidths, gridToPx, type BoardPage, type ShapeState } from '@chalk/board';
import { rect, ellipse, line, curve, linear, FILL, type RPath } from './rough';
import { api } from '../api';

export const STROKE: Record<ShapeStyle, string> = {
  default: 'var(--chalk)', accent: 'var(--chalk-accent)', muted: 'var(--chalk-muted)',
  good: 'var(--chalk-good)', warn: 'var(--chalk-warn)', bad: 'var(--chalk-bad)',
};
const colorOf = (s: ShapeState) => STROKE[s.style ?? 'default'] ?? STROKE.default;

export function Paths({ paths, color, fill, width = 2.2, fillOpacity = 0.32 }: { paths: RPath[]; color: string; fill?: string; width?: number; fillOpacity?: number }) {
  return (
    <>
      {paths.map((p, i) => p.kind === 'solid'
        ? <path key={i} className="fillpath" d={p.d} style={{ fill: fill ?? color, stroke: 'none' }} />
        : <path key={i} className="stroke" d={p.d} pathLength={1}
            style={p.kind === 'sketch' ? { stroke: fill ?? color, strokeWidth: 1.1, opacity: fillOpacity } : { stroke: color, strokeWidth: width }} />)}
    </>
  );
}

function Lines({ text, x, y, size = 26, anchor = 'middle', color, weight, lineH }: { text: string; x: number; y: number; size?: number; anchor?: 'start' | 'middle' | 'end'; color?: string; weight?: number; lineH?: number }) {
  const lines = text.split('\n');
  const lh = lineH ?? size * 1.3;
  const top = y - ((lines.length - 1) * lh) / 2;
  return (
    <text className="label" x={x} y={top} textAnchor={anchor} dominantBaseline="central" style={{ fontSize: size, fill: color, fontWeight: weight }}>
      {lines.map((l, i) => <tspan key={i} x={x} dy={i === 0 ? 0 : lh}>{l || ' '}</tspan>)}
    </text>
  );
}

const filled = (s: ShapeState) => s.style && s.style !== 'default' && s.style !== 'muted';

function Box({ s }: { s: ShapeState }) {
  const c = colorOf(s);
  const p = useMemo(() => rect(s.id, s.x, s.y, s.w, s.h, filled(s) ? { fill: FILL, fillStyle: 'hachure', hachureGap: 9 } : {}), [s.id, s.x, s.y, s.w, s.h, s.style]);
  return <><Paths paths={p} color={c} />{s.text && <Lines text={s.text} x={s.x + s.w / 2} y={s.y + s.h / 2} color="var(--chalk)" />}</>;
}

function Circle({ s }: { s: ShapeState }) {
  const c = colorOf(s);
  const p = useMemo(() => ellipse(s.id, s.x + s.w / 2, s.y + s.h / 2, s.w, s.h, filled(s) ? { fill: FILL, fillStyle: 'hachure', hachureGap: 9 } : {}), [s.id, s.x, s.y, s.w, s.h, s.style]);
  return <><Paths paths={p} color={c} />{s.text && <Lines text={s.text} x={s.x + s.w / 2} y={s.y + s.h / 2} color="var(--chalk)" />}</>;
}

function Sticky({ s }: { s: ShapeState }) {
  const p = useMemo(() => rect(s.id, s.x, s.y, s.w, s.h, { fill: FILL, fillStyle: 'solid', roughness: 0.6 }), [s.id, s.x, s.y, s.w, s.h]);
  const tilt = ((s.id.charCodeAt(0) % 5) - 2) * 0.7;
  return (
    <g transform={`rotate(${tilt} ${s.x + s.w / 2} ${s.y + s.h / 2})`}>
      <Paths paths={p} color="var(--sticky)" fill="var(--sticky)" width={1.4} />
      <foreignObject x={s.x} y={s.y} width={s.w} height={s.h}><div className="fo-sticky">{s.text}</div></foreignObject>
    </g>
  );
}

function Text({ s }: { s: ShapeState }) {
  const accent = s.style === 'accent';
  return <Lines text={s.text ?? ''} x={s.x + s.w / 2} y={s.y + s.h / 2} size={accent ? 34 : 28} weight={accent ? 700 : 400} color={s.style ? colorOf(s) : 'var(--chalk)'} />;
}

function Formula({ s }: { s: ShapeState }) {
  const html = useMemo(() => katex.renderToString(s.latex ?? s.text ?? '', { throwOnError: false, displayMode: true, output: 'html' }), [s.latex, s.text]);
  const pad = 40;
  return (
    <foreignObject x={s.x - pad} y={s.y - 8} width={s.w + pad * 2} height={s.h + 16}>
      <div className="fo-formula" style={{ color: s.style ? colorOf(s) : undefined }} dangerouslySetInnerHTML={{ __html: html }} />
    </foreignObject>
  );
}

function Code({ s }: { s: ShapeState }) {
  const code = s.code ?? s.text ?? '';
  const html = useMemo(() => {
    try {
      return s.lang && hljs.getLanguage(s.lang) ? hljs.highlight(code, { language: s.lang }).value : hljs.highlightAuto(code).value;
    } catch { return escapeHtml(code); }
  }, [code, s.lang]);
  const p = useMemo(() => rect(s.id, s.x, s.y, s.w, s.h, { roughness: 0.7, strokeWidth: 1.5 }), [s.id, s.x, s.y, s.w, s.h]);
  return (
    <>
      <Paths paths={p} color="var(--chalk-muted)" width={1.5} />
      <foreignObject x={s.x} y={s.y} width={s.w} height={s.h}><pre className="fo-code" dangerouslySetInnerHTML={{ __html: html }} /></foreignObject>
    </>
  );
}

function Table({ s }: { s: ShapeState }) {
  const rows = s.rows ?? [[s.text ?? '']];
  const natural = tableColumnWidths(rows);
  const total = natural.reduce((a, b) => a + b, 0) || 1;
  const widths = natural.map((w) => (w / total) * s.w);
  const rh = s.h / rows.length;
  const paths = useMemo(() => {
    const out: RPath[] = [...rect(s.id, s.x, s.y, s.w, s.h, { roughness: 0.8 })];
    for (let r = 1; r < rows.length; r++) out.push(...line(`${s.id}r${r}`, s.x, s.y + r * rh, s.x + s.w, s.y + r * rh, { roughness: 0.6, strokeWidth: r === 1 ? 2 : 1 }));
    let x = s.x;
    for (let c = 0; c < widths.length - 1; c++) { x += widths[c]; out.push(...line(`${s.id}c${c}`, x, s.y, x, s.y + s.h, { roughness: 0.6, strokeWidth: 1 })); }
    return out;
  }, [s.id, s.x, s.y, s.w, s.h, rows.length, widths.join(',')]);
  return (
    <>
      <Paths paths={paths} color={colorOf(s)} width={1.6} />
      {rows.map((row, r) => {
        let x = s.x;
        return row.map((cell, c) => {
          const cx = x + widths[c] / 2;
          x += widths[c];
          return <Lines key={`${r}-${c}`} text={cell} x={cx} y={s.y + r * rh + rh / 2} size={22} weight={r === 0 ? 700 : 400} color={r === 0 ? 'var(--chalk-accent)' : 'var(--chalk)'} />;
        });
      })}
    </>
  );
}

function Chart({ s }: { s: ShapeState }) {
  const spec = s.chart;
  const pad = { l: 52, r: 12, t: 26, b: 38 };
  const iw = s.w - pad.l - pad.r, ih = s.h - pad.t - pad.b;
  const ox = s.x + pad.l, oy = s.y + pad.t + ih;
  const data = spec?.data ?? [];
  const max = Math.max(1e-9, ...data.map((d) => d.y));
  const paths = useMemo(() => {
    const out: RPath[] = [...line(`${s.id}ax`, ox, oy, ox + iw, oy, { roughness: 0.5 }), ...line(`${s.id}ay`, ox, oy, ox, oy - ih, { roughness: 0.5 })];
    if (spec?.type === 'line') {
      const pts = data.map((d, i): [number, number] => [ox + (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * iw), oy - (d.y / max) * ih]);
      if (pts.length > 1) out.push(...linear(`${s.id}ln`, pts, { strokeWidth: 2.4 }));
    }
    return out;
  }, [s.id, s.x, s.y, s.w, s.h, JSON.stringify(spec)]);
  const bw = data.length ? (iw / data.length) * 0.62 : 0;
  return (
    <>
      <Paths paths={paths} color="var(--chalk)" />
      {spec?.type !== 'line' && data.map((d, i) => {
        const h = (d.y / max) * ih;
        const x = ox + (i + 0.19) * (iw / data.length);
        return <Paths key={i} paths={rect(`${s.id}b${i}`, x, oy - h, bw, h, { fill: FILL, fillStyle: 'hachure', hachureGap: 6 })} color="var(--chalk-accent)" />;
      })}
      {data.map((d, i) => {
        const x = spec?.type === 'line' ? ox + (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * iw) : ox + (i + 0.5) * (iw / data.length);
        return <text key={`x${i}`} className="label" x={x} y={oy + 18} textAnchor="middle" style={{ fontSize: 18, fill: 'var(--chalk-dim)' }}>{String(d.x)}</text>;
      })}
      <text className="label" x={ox - 8} y={oy - ih} textAnchor="end" dominantBaseline="central" style={{ fontSize: 18, fill: 'var(--chalk-dim)' }}>{fmt(max)}</text>
      <text className="label" x={ox - 8} y={oy} textAnchor="end" dominantBaseline="central" style={{ fontSize: 18, fill: 'var(--chalk-dim)' }}>0</text>
      {spec?.yLabel && <text className="label" x={ox + 8} y={s.y + 2} style={{ fontSize: 18, fill: 'var(--chalk-dim)' }} dominantBaseline="hanging">{spec.yLabel}</text>}
      {spec?.xLabel && <text className="label" x={ox + iw} y={s.y + s.h - 2} textAnchor="end" style={{ fontSize: 18, fill: 'var(--chalk-dim)' }}>{spec.xLabel}</text>}
    </>
  );
}

const fmt = (n: number) => (Math.abs(n) >= 1000 ? `${Math.round(n / 100) / 10}k` : String(Math.round(n * 100) / 100));

let mermaidSeq = 0;
function Mermaid({ s }: { s: ShapeState }) {
  const [svg, setSvg] = useState<string>('');
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    (async () => {
      const { default: mermaid } = await import('mermaid');
      const dark = !document.documentElement.dataset.theme || document.documentElement.dataset.theme === 'contrast';
      const cs = getComputedStyle(document.documentElement);
      mermaid.initialize({
        startOnLoad: false, securityLevel: 'strict', theme: 'base',
        fontFamily: 'Kalam, cursive',
        themeVariables: {
          darkMode: dark, background: 'transparent', fontSize: '18px',
          primaryColor: cs.getPropertyValue('--board').trim(), primaryTextColor: cs.getPropertyValue('--chalk').trim(),
          primaryBorderColor: cs.getPropertyValue('--chalk').trim(), lineColor: cs.getPropertyValue('--chalk-dim').trim(),
          secondaryColor: cs.getPropertyValue('--board-edge').trim(), tertiaryColor: cs.getPropertyValue('--board').trim(),
          actorBkg: cs.getPropertyValue('--board').trim(), actorBorder: cs.getPropertyValue('--chalk').trim(), actorTextColor: cs.getPropertyValue('--chalk').trim(),
          signalColor: cs.getPropertyValue('--chalk').trim(), signalTextColor: cs.getPropertyValue('--chalk').trim(), noteBkgColor: cs.getPropertyValue('--sticky').trim(),
        },
      });
      try {
        const out = await mermaid.render(`mmd-${++mermaidSeq}`, s.code ?? '');
        if (alive) setSvg(out.svg);
      } catch (e) {
        if (alive) setErr(String((e as Error).message ?? e).slice(0, 200));
      }
    })();
    return () => { alive = false; };
  }, [s.code]);
  return (
    <foreignObject x={s.x} y={s.y} width={s.w} height={s.h}>
      {err ? <pre className="fo-code" style={{ color: 'var(--chalk-bad)', whiteSpace: 'pre-wrap' }}>Diagram error: {err}</pre>
        : <div className="fo-mermaid" dangerouslySetInnerHTML={{ __html: svg }} />}
    </foreignObject>
  );
}

function Image({ s }: { s: ShapeState }) {
  if (s.lang === 'mermaid') return <Mermaid s={s} />;
  const src = s.src ?? '';
  const href = src.startsWith('data:image/') ? src : src && !/^[a-z]+:/i.test(src) ? api.fileUrl(src) : '';
  const p = useMemo(() => rect(s.id, s.x, s.y, s.w, s.h, { roughness: 0.5, strokeWidth: 1.2 }), [s.id, s.x, s.y, s.w, s.h]);
  return (
    <>
      {href ? <image href={href} x={s.x} y={s.y} width={s.w} height={s.h} preserveAspectRatio="xMidYMid meet" className="label" />
        : <Lines text={`image: ${src || '(missing src)'}`} x={s.x + s.w / 2} y={s.y + s.h / 2} size={15} color="var(--chalk-muted)" />}
      <Paths paths={p} color="var(--chalk-muted)" width={1.2} />
    </>
  );
}

function PathShape({ s }: { s: ShapeState }) {
  const pts = (s.points ?? []).map((p): [number, number] => { const q = gridToPx(p); return [q.x, q.y]; });
  const p = useMemo(() => (pts.length > 1 ? curve(s.id, pts, { strokeWidth: s.user ? 3 : 2.4 }) : []), [s.id, JSON.stringify(s.points)]);
  return <Paths paths={p} color={s.user ? STROKE[s.style ?? 'warn'] : colorOf(s)} width={s.user ? 3 : 2.4} />;
}

function Frame({ s }: { s: ShapeState }) {
  const p = useMemo(() => rect(s.id, s.x, s.y, s.w, s.h, { roughness: 0.8, strokeWidth: 1.4, strokeLineDash: [10, 8] }), [s.id, s.x, s.y, s.w, s.h]);
  return (
    <>
      <Paths paths={p} color="var(--chalk-muted)" width={1.4} />
      {(s.title ?? s.text) && <text className="label" x={s.x + 10} y={s.y - 8} style={{ fontSize: 21, fill: 'var(--chalk-muted)' }}>{s.title ?? s.text}</text>}
    </>
  );
}

function Arrow({ s, page }: { s: ShapeState; page: BoardPage }) {
  const g = arrowGeometry(page, s);
  const key = g ? `${g.x1.toFixed(1)},${g.y1.toFixed(1)},${g.x2.toFixed(1)},${g.y2.toFixed(1)}` : '';
  const paths = useMemo(() => {
    if (!g) return [];
    const ang = Math.atan2(g.y2 - g.y1, g.x2 - g.x1), L = 14, spread = 0.45;
    return [
      ...line(s.id, g.x1, g.y1, g.x2, g.y2, { roughness: 0.9 }),
      ...line(`${s.id}h1`, g.x2, g.y2, g.x2 - L * Math.cos(ang - spread), g.y2 - L * Math.sin(ang - spread), { roughness: 0.4 }),
      ...line(`${s.id}h2`, g.x2, g.y2, g.x2 - L * Math.cos(ang + spread), g.y2 - L * Math.sin(ang + spread), { roughness: 0.4 }),
    ];
  }, [s.id, key]);
  if (!g) return null;
  const mx = (g.x1 + g.x2) / 2, my = (g.y1 + g.y2) / 2;
  return (
    <>
      <Paths paths={paths} color={colorOf(s)} />
      {s.label && (
        <g className="label">
          <rect x={mx - s.label.length * 5.2 - 8} y={my - 16} width={s.label.length * 10.4 + 16} height={30} rx={7} style={{ fill: 'var(--board)' }} />
          <Lines text={s.label} x={mx} y={my - 1} size={20} color="var(--chalk-dim)" />
        </g>
      )}
    </>
  );
}

export const ShapeView = memo(function ShapeView({ s, page, animMs, selected, pulsing, onPointerDown }: {
  s: ShapeState; page: BoardPage; animMs?: number; selected?: boolean; pulsing?: boolean;
  onPointerDown?: (e: React.PointerEvent, id: string) => void;
}) {
  let body: React.ReactNode;
  switch (s.kind) {
    case 'box': body = <Box s={s} />; break;
    case 'circle': body = <Circle s={s} />; break;
    case 'sticky': body = <Sticky s={s} />; break;
    case 'text': body = <Text s={s} />; break;
    case 'formula': body = <Formula s={s} />; break;
    case 'code': body = <Code s={s} />; break;
    case 'table': body = <Table s={s} />; break;
    case 'chart': body = <Chart s={s} />; break;
    case 'image': body = <Image s={s} />; break;
    case 'path': body = <PathShape s={s} />; break;
    case 'frame': body = <Frame s={s} />; break;
    case 'arrow': body = <Arrow s={s} page={page} />; break;
    default: body = null;
  }
  const cls = ['shape', animMs ? 'draw' : '', s.faded ? 'faded' : '', selected ? 'selected' : '', pulsing ? 'pulse' : ''].filter(Boolean).join(' ');
  const style = animMs ? ({ '--dur': `${animMs}ms` } as CSSProperties) : undefined;
  const label = [s.text, s.label, s.latex, s.title].filter(Boolean).join(' ') || s.kind;
  return (
    <g className={cls} style={style} data-id={s.id} onPointerDown={onPointerDown ? (e) => onPointerDown(e, s.id) : undefined} role="img" aria-label={`${s.kind}: ${label}`}>
      {s.kind !== 'arrow' && s.kind !== 'group' && <rect className="sel" x={s.x - 6} y={s.y - 6} width={s.w + 12} height={s.h + 12} rx={8} />}
      {/* invisible hit area so thin strokes are easy to click */}
      {s.kind !== 'arrow' && s.kind !== 'group' && s.kind !== 'frame' && <rect x={s.x} y={s.y} width={s.w} height={s.h} fill="transparent" />}
      {body}
    </g>
  );
}, (a, b) => a.s === b.s && a.animMs === b.animMs && a.selected === b.selected && a.pulsing === b.pulsing && (a.s.kind !== 'arrow' || a.page === b.page));

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}
