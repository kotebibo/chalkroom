// The whiteboard: renders the player's board state, effects, selection and pen input.
import { useRef, useState, useSyncExternalStore, useMemo } from 'react';
import { BOARD_W, BOARD_H, pxToGrid, type BoardPage, type Camera } from '@chalk/board';
import { ShapeView, Paths } from './Shapes';
import { ellipse, line } from './rough';
import type { Player, ActiveEffect } from '../lib/player';

export type Tool = 'select' | 'pen' | 'erase';

interface Props {
  player: Player;
  id?: string;
  tool?: Tool;
  selection?: string[];
  onSelect?: (ids: string[]) => void;
  onDraw?: (points: [number, number][]) => void;
  onErase?: (id: string) => void;
  emptyHint?: string;
}

export function usePlayer(player: Player) {
  useSyncExternalStore(player.subscribe, player.getVersion);
  return player;
}

function bbox(page: BoardPage, ids: string[]) {
  const rs = ids.map((id) => page.shapes[id]).filter((s) => s && s.kind !== 'arrow');
  if (!rs.length) return null;
  const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y));
  return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y };
}

function EffectView({ fx, page }: { fx: ActiveEffect; page: BoardPage }) {
  const b = bbox(page, fx.ids);
  if (!b || fx.kind === 'pulse') return null;
  const key = `fx${fx.key}`;
  if (fx.kind === 'highlight') return <rect className="fx-highlight" x={b.x - 12} y={b.y - 10} width={b.w + 24} height={b.h + 20} rx={14} />;
  if (fx.kind === 'underline') return <g className="fx draw" style={{ ['--dur' as string]: '450ms' }}><Paths paths={line(key, b.x - 4, b.y + b.h + 9, b.x + b.w + 4, b.y + b.h + 7, { strokeWidth: 3 })} color="var(--chalk-accent)" width={3} /></g>;
  return <g className="fx draw" style={{ ['--dur' as string]: '600ms' }}><Paths paths={ellipse(key, b.x + b.w / 2, b.y + b.h / 2, b.w * 1.18 + 34, b.h * 1.3 + 30, { strokeWidth: 3 })} color="var(--chalk-accent)" width={3} /></g>;
}

export function PageView({ page, camera, animate, effects, selection, onShapeDown }: {
  page: BoardPage; camera: Camera; animate?: Map<string, number>; effects?: ActiveEffect[]; selection?: string[];
  onShapeDown?: (e: React.PointerEvent, id: string) => void;
}) {
  const pulsing = new Set(effects?.filter((f) => f.kind === 'pulse').flatMap((f) => f.ids));
  const sel = new Set(selection);
  // frames first so they sit under everything; arrows last so heads stay visible
  const order = [...page.order].sort((a, b) => rank(page, a) - rank(page, b));
  return (
    <g className="camera" style={{ transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`, transformOrigin: '0 0' }}>
      {effects?.filter((f) => f.kind === 'highlight').map((fx) => <EffectView key={fx.key} fx={fx} page={page} />)}
      {order.map((id) => {
        const s = page.shapes[id];
        if (!s) return null;
        return <ShapeView key={id} s={s} page={page} animMs={animate?.get(id)} selected={sel.has(id)} pulsing={pulsing.has(id)} onPointerDown={onShapeDown} />;
      })}
      {effects?.filter((f) => f.kind === 'underline' || f.kind === 'circle').map((fx) => <EffectView key={fx.key} fx={fx} page={page} />)}
    </g>
  );
}

const rank = (page: BoardPage, id: string) => {
  const k = page.shapes[id]?.kind;
  return k === 'frame' ? 0 : k === 'arrow' ? 2 : 1;
};

export function Board({ player, id = 'chalk-board', tool = 'select', selection = [], onSelect, onDraw, onErase, emptyHint }: Props) {
  usePlayer(player);
  const svgRef = useRef<SVGSVGElement>(null);
  const [stroke, setStroke] = useState<[number, number][] | null>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  const st = player.state;
  const pageIndex = player.viewPage ?? st.current;
  const page = st.pages[pageIndex] ?? st.pages[st.current];
  const camera = pageIndex === st.current ? st.camera : { x: 0, y: 0, zoom: 1 };
  const live = pageIndex === st.current;

  const toBoard = (e: React.PointerEvent) => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: p.x / camera.zoom + camera.x, y: p.y / camera.zoom + camera.y };
  };

  const onShapeDown = (e: React.PointerEvent, sid: string) => {
    if (tool === 'erase') {
      if (page.shapes[sid]?.user) { e.stopPropagation(); onErase?.(sid); }
      return;
    }
    if (tool !== 'select') return;
    e.stopPropagation();
    const next = e.shiftKey || e.ctrlKey || e.metaKey
      ? (selection.includes(sid) ? selection.filter((x) => x !== sid) : [...selection, sid])
      : (selection.length === 1 && selection[0] === sid ? [] : [sid]);
    onSelect?.(next);
  };

  const onDown = (e: React.PointerEvent) => {
    const p = toBoard(e);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (tool === 'pen') setStroke([[p.x, p.y]]);
    else if (tool === 'select') { setMarquee({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); if (!e.shiftKey) onSelect?.([]); }
  };
  const onMove = (e: React.PointerEvent) => {
    if (!stroke && !marquee) return;
    const p = toBoard(e);
    if (stroke) {
      const last = stroke[stroke.length - 1];
      if (Math.hypot(p.x - last[0], p.y - last[1]) > 4) setStroke([...stroke, [p.x, p.y]]);
    } else if (marquee) setMarquee({ ...marquee, x1: p.x, y1: p.y });
  };
  const onUp = () => {
    if (stroke) {
      if (stroke.length > 2) onDraw?.(simplify(stroke).map(([x, y]) => pxToGrid(x, y)));
      setStroke(null);
    }
    if (marquee) {
      const x = Math.min(marquee.x0, marquee.x1), y = Math.min(marquee.y0, marquee.y1);
      const w = Math.abs(marquee.x1 - marquee.x0), h = Math.abs(marquee.y1 - marquee.y0);
      if (w > 8 && h > 8) {
        const hit = page.order.filter((sid) => {
          const s = page.shapes[sid];
          return s && s.kind !== 'arrow' && s.x < x + w && s.x + s.w > x && s.y < y + h && s.y + s.h > y;
        });
        onSelect?.([...new Set([...selection, ...hit])]);
      }
      setMarquee(null);
    }
  };

  const strokePath = useMemo(() => stroke && stroke.length > 1 ? 'M' + stroke.map((p) => p.join(',')).join(' L') : '', [stroke]);

  return (
    <svg
      ref={svgRef}
      id={id}
      className={`board-svg ${tool}`}
      viewBox={`0 0 ${BOARD_W} ${BOARD_H}`}
      preserveAspectRatio="xMidYMid meet"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      role="img"
      aria-label={`Whiteboard${page.title ? `: ${page.title}` : ''}. ${page.order.length} shapes.`}
    >
      <PageView page={page} camera={camera} animate={live ? player.animate : undefined} effects={live ? player.effects : undefined} selection={selection} onShapeDown={onShapeDown} />
      {strokePath && <path d={strokePath} className="stroke" style={{ stroke: 'var(--chalk-warn)', strokeWidth: 3 }} />}
      {marquee && <rect x={Math.min(marquee.x0, marquee.x1)} y={Math.min(marquee.y0, marquee.y1)} width={Math.abs(marquee.x1 - marquee.x0)} height={Math.abs(marquee.y1 - marquee.y0)} fill="color-mix(in srgb, var(--chalk-blue) 12%, transparent)" stroke="var(--chalk-blue)" strokeDasharray="5 4" />}
      {!page.order.length && emptyHint && <text className="board-empty" x={BOARD_W / 2} y={BOARD_H / 2} textAnchor="middle" dominantBaseline="central">{emptyHint}</text>}
      {page.title && page.order.length > 0 && <text x={26} y={40} style={{ fontSize: 22, fill: 'var(--chalk-muted)' }}>{page.title}</text>}
    </svg>
  );
}

export function PageStrip({ player }: { player: Player }) {
  usePlayer(player);
  const st = player.state;
  if (st.pages.length < 2) return null;
  const viewing = player.viewPage ?? st.current;
  return (
    <div className="pagestrip" role="tablist" aria-label="Board pages">
      {st.pages.map((p, i) => (
        <button key={p.id} className="thumb" role="tab" aria-current={i === viewing} aria-label={`Page ${i + 1}: ${p.title}`}
          onClick={() => player.setViewPage(i === st.current ? null : i)}>
          <svg className="board-mini" viewBox={`0 0 ${BOARD_W} ${BOARD_H}`} width="108" height="52" aria-hidden>
            <PageView page={p} camera={{ x: 0, y: 0, zoom: 1 }} />
          </svg>
          <span>{i + 1}. {p.title}</span>
        </button>
      ))}
    </div>
  );
}

/** Drop near-collinear points so stored strokes stay small. */
function simplify(pts: [number, number][], tol = 2.5): [number, number][] {
  if (pts.length < 3) return pts;
  const out: [number, number][] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const [ax, ay] = out[out.length - 1], [bx, by] = pts[i], [cx, cy] = pts[i + 1];
    const d = Math.abs((cx - ax) * (ay - by) - (ax - bx) * (cy - ay)) / (Math.hypot(cx - ax, cy - ay) || 1);
    if (d > tol) out.push(pts[i]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}
