// Board Script engine: a pure reducer from steps to board state, plus layout.
// Used by the server (board_state, resume summaries) and by the browser player.
import type { BoardStep, Shape, GridPos } from '@chalk/schema';

export const GRID = { cols: 12, rows: 8, cellW: 110, cellH: 80 };
export const BOARD_W = GRID.cols * GRID.cellW;
export const BOARD_H = GRID.rows * GRID.cellH;

export interface Rect { x: number; y: number; w: number; h: number }
export interface ShapeState extends Shape { x: number; y: number; w: number; h: number; faded?: boolean; user?: boolean }
export interface BoardPage { id: string; title: string; shapes: Record<string, ShapeState>; order: string[] }
export interface Camera { x: number; y: number; zoom: number }
export interface BoardState { pages: BoardPage[]; current: number; camera: Camera }

/** Transient visual effects the player renders over the board. */
export type Effect =
  | { kind: 'draw'; id: string }
  | { kind: 'update'; id: string }
  | { kind: 'remove'; ids: string[] }
  | { kind: 'move'; id: string }
  | { kind: 'highlight' | 'underline' | 'circle' | 'pulse'; ids: string[]; seconds: number }
  | { kind: 'fade'; ids: string[] }
  | { kind: 'camera' }
  | { kind: 'clear' }
  | { kind: 'page' }
  | { kind: 'say'; text: string }
  | { kind: 'wait'; seconds: number }
  | { kind: 'error'; message: string };

export const DEFAULT_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

export function emptyBoard(): BoardState {
  return { pages: [{ id: 'p1', title: 'Page 1', shapes: {}, order: [] }], current: 0, camera: { ...DEFAULT_CAMERA } };
}

export const currentPage = (s: BoardState) => s.pages[s.current];

// ---------------------------------------------------------------------------
// Sizing
// ---------------------------------------------------------------------------

const FONT = 26;
const CHAR_W = 0.5; // average glyph width as a fraction of font size
const MONO_W = 0.62;

const textWidth = (text: string, size = FONT) =>
  Math.max(...text.split('\n').map((l) => l.length), 1) * size * CHAR_W;
const textLines = (text: string) => text.split('\n').length;

export function gridToPx([c, r]: GridPos): { x: number; y: number } {
  return { x: (c + 0.5) * GRID.cellW, y: (r + 0.5) * GRID.cellH };
}

export function pxToGrid(x: number, y: number): GridPos {
  return [round1(x / GRID.cellW - 0.5), round1(y / GRID.cellH - 0.5)];
}
const round1 = (n: number) => Math.round(n * 10) / 10;

function naturalSize(s: Shape): { w: number; h: number } {
  const t = s.text ?? '';
  const sized = (w: number, h: number) => ({
    w: s.size ? s.size[0] * GRID.cellW : w,
    h: s.size ? s.size[1] * GRID.cellH : h,
  });
  switch (s.kind) {
    case 'box': return sized(Math.max(160, textWidth(t) + 44), Math.max(70, textLines(t) * 34 + 30));
    case 'circle': { const d = Math.max(100, textWidth(t) + 40); return sized(d, d); }
    case 'sticky': return sized(Math.max(190, Math.min(300, textWidth(t, 24) / 2 + 40)), Math.max(120, Math.ceil(textWidth(t, 24) / 250) * 32 + 44));
    case 'text': return sized(textWidth(t, s.style === 'accent' ? 34 : 28) + 12, textLines(t) * 38 + 8);
    case 'formula': return sized(Math.max(100, (s.latex ?? t).replace(/\\[a-zA-Z]+/g, 'x').length * 15), 70);
    case 'code': {
      const code = s.code ?? t;
      const lines = code.split('\n');
      return sized(Math.max(240, Math.max(...lines.map((l) => l.length)) * 19 * MONO_W + 36), lines.length * 27 + 30);
    }
    case 'table': {
      const rows = s.rows ?? [[t]];
      const cols = Math.max(...rows.map((r) => r.length));
      const colW = Array.from({ length: cols }, (_, i) => Math.max(...rows.map((r) => textWidth(r[i] ?? '', 22))) + 28);
      return sized(colW.reduce((a, b) => a + b, 0), rows.length * 44);
    }
    case 'chart': return sized(4 * GRID.cellW, 3 * GRID.cellH);
    case 'image': return sized(3 * GRID.cellW, 2.5 * GRID.cellH);
    case 'frame': return sized(5 * GRID.cellW, 4 * GRID.cellH);
    default: return sized(0, 0);
  }
}

export function tableColumnWidths(rows: string[][]): number[] {
  const cols = Math.max(...rows.map((r) => r.length));
  return Array.from({ length: cols }, (_, i) => Math.max(...rows.map((r) => textWidth(r[i] ?? '', 22))) + 28);
}

function boundsOf(points: GridPos[]): Rect {
  const px = points.map(gridToPx);
  const xs = px.map((p) => p.x), ys = px.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function groupBounds(page: BoardPage, ids: string[]): Rect {
  const rs = ids.map((id) => page.shapes[id]).filter(Boolean);
  if (!rs.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.min(...rs.map((r) => r.x)) - 16, y = Math.min(...rs.map((r) => r.y)) - 16;
  return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) + 16 - x, h: Math.max(...rs.map((r) => r.y + r.h)) + 16 - y };
}

const overlaps = (a: Rect, b: Rect, pad = 8) =>
  a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

const isSolid = (s: Shape) => !['arrow', 'group', 'frame', 'path'].includes(s.kind);

/** Resolve a shape's pixel rect. Non-positioned shapes are placed in the first free slot. */
export function layoutShape(page: BoardPage, s: Shape): ShapeState {
  if (s.kind === 'arrow') return { ...s, x: 0, y: 0, w: 0, h: 0 };
  if (s.kind === 'path' && s.points?.length) return { ...s, ...boundsOf(s.points) };
  if (s.kind === 'group' && s.children?.length) return { ...s, ...groupBounds(page, s.children) };
  const { w, h } = naturalSize(s);
  const place = (c: { x: number; y: number }): ShapeState => ({ ...s, x: c.x - w / 2, y: c.y - h / 2, w, h });
  if (s.kind === 'frame') return place(gridToPx(s.at ?? [5.5, 3.5]));

  const others = page.order.map((id) => page.shapes[id]).filter((o) => o && o.id !== s.id && isSolid(o) && !o.faded);
  const free = (r: Rect) => !others.some((o) => overlaps(r, o));
  const inBoard = (r: Rect) => r.x >= 0 && r.y >= 0 && r.x + r.w <= BOARD_W && r.y + r.h <= BOARD_H;

  if (s.at) {
    let r = place(gridToPx(s.at));
    if (free(r)) return r;
    // nudge: try small offsets in growing rings, prefer down then right
    for (let ring = 1; ring <= 6; ring++) {
      for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, 1]]) {
        const c = gridToPx([s.at[0] + dx * ring * 0.5, s.at[1] + dy * ring * 0.5]);
        r = place(c);
        if (free(r) && inBoard(r)) return r;
      }
    }
    return place(gridToPx(s.at));
  }
  for (let row = 0; row < GRID.rows; row += 0.5) {
    for (let col = 0; col < GRID.cols; col += 0.5) {
      const r = place(gridToPx([col + w / GRID.cellW / 2 - 0.5, row + h / GRID.cellH / 2 - 0.5]));
      if (free(r) && inBoard(r)) return r;
    }
  }
  return place(gridToPx([5.5, 3.5]));
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

const toIds = (v: string | string[]) => (Array.isArray(v) ? v : [v]);

function clonePage(p: BoardPage): BoardPage {
  return { ...p, shapes: { ...p.shapes }, order: [...p.order] };
}

/** Apply one step. Returns a new state and the effect for the player. Never throws. */
export function applyStep(state: BoardState, step: BoardStep): { state: BoardState; effect: Effect } {
  const pages = [...state.pages];
  const page = clonePage(pages[state.current]);
  pages[state.current] = page;
  const next: BoardState = { ...state, pages };
  const err = (message: string) => ({ state, effect: { kind: 'error', message } as Effect });
  const s = step as Record<string, any>;

  if ('add' in s || 'write' in s) {
    const raw = (s.add ?? s.write) as Shape;
    const kind = raw.kind ?? (raw.latex ? 'formula' : raw.code ? 'code' : 'text');
    const shape = layoutShape(page, { ...raw, kind });
    if (!page.shapes[shape.id]) page.order.push(shape.id);
    page.shapes[shape.id] = shape;
    return { state: next, effect: { kind: 'draw', id: shape.id } };
  }
  if ('mermaid' in s) {
    const m = s.mermaid;
    const shape: ShapeState = { ...layoutShape(page, { id: m.id, kind: 'image', at: m.at, size: m.size ?? [6, 4] }), code: m.code, lang: 'mermaid' };
    if (!page.shapes[shape.id]) page.order.push(shape.id);
    page.shapes[shape.id] = shape;
    return { state: next, effect: { kind: 'draw', id: shape.id } };
  }
  if ('update' in s) {
    const cur = page.shapes[s.update.id];
    if (!cur) return err(`update: unknown shape ${s.update.id}`);
    const merged = { ...cur, ...s.update };
    const needsLayout = s.update.at || s.update.text !== undefined || s.update.size || s.update.latex || s.update.code;
    page.shapes[cur.id] = needsLayout ? layoutShape(page, { ...merged, at: s.update.at ?? pxToGrid(cur.x + cur.w / 2, cur.y + cur.h / 2) }) : merged;
    return { state: next, effect: { kind: 'update', id: cur.id } };
  }
  if ('remove' in s) {
    const ids = toIds(s.remove);
    for (const id of ids) {
      delete page.shapes[id];
      // drop arrows attached to removed shapes
      for (const o of Object.values(page.shapes)) if (o.kind === 'arrow' && (o.from === id || o.to === id)) delete page.shapes[o.id];
    }
    page.order = page.order.filter((id) => page.shapes[id]);
    return { state: next, effect: { kind: 'remove', ids } };
  }
  if ('move' in s) {
    const cur = page.shapes[s.move.id];
    if (!cur) return err(`move: unknown shape ${s.move.id}`);
    const c = gridToPx(s.move.to);
    page.shapes[cur.id] = { ...cur, x: c.x - cur.w / 2, y: c.y - cur.h / 2, at: s.move.to };
    return { state: next, effect: { kind: 'move', id: cur.id } };
  }
  for (const k of ['highlight', 'underline', 'circle', 'pulse'] as const) {
    if (k in s) {
      const ids = toIds(s[k]).filter((id) => page.shapes[id]);
      if (!ids.length) return err(`${k}: unknown shape ${s[k]}`);
      return { state, effect: { kind: k, ids, seconds: s.for ?? (k === 'pulse' ? 1.2 : 2) } };
    }
  }
  if ('fade' in s) {
    const ids = toIds(s.fade).filter((id) => page.shapes[id]);
    for (const id of ids) page.shapes[id] = { ...page.shapes[id], faded: true };
    return { state: next, effect: { kind: 'fade', ids } };
  }
  if ('camera' in s) {
    const c = s.camera;
    let cam: Camera = { ...DEFAULT_CAMERA };
    if (c.frame && page.shapes[c.frame]) {
      const f = page.shapes[c.frame];
      const zoom = Math.min(BOARD_W / (f.w + 40), BOARD_H / (f.h + 40));
      cam = { x: f.x + f.w / 2 - BOARD_W / 2 / zoom, y: f.y + f.h / 2 - BOARD_H / 2 / zoom, zoom };
    } else if (c.at || c.zoom) {
      const zoom = c.zoom ?? 1;
      const p = c.at ? gridToPx(c.at) : { x: BOARD_W / 2, y: BOARD_H / 2 };
      cam = { x: p.x - BOARD_W / 2 / zoom, y: p.y - BOARD_H / 2 / zoom, zoom };
    }
    return { state: { ...next, camera: cam }, effect: { kind: 'camera' } };
  }
  if ('clear' in s) {
    pages[state.current] = { ...page, shapes: {}, order: [] };
    return { state: { ...next, camera: { ...DEFAULT_CAMERA } }, effect: { kind: 'clear' } };
  }
  if ('page' in s) {
    if (!page.order.length) {
      pages[state.current] = { ...page, title: s.page.title ?? page.title };
      return { state: next, effect: { kind: 'page' } };
    }
    const n = pages.length + 1;
    pages.push({ id: `p${n}`, title: s.page.title ?? `Page ${n}`, shapes: {}, order: [] });
    return { state: { ...next, current: pages.length - 1, camera: { ...DEFAULT_CAMERA } }, effect: { kind: 'page' } };
  }
  if ('say' in s) return { state, effect: { kind: 'say', text: s.say } };
  if ('wait' in s) return { state, effect: { kind: 'wait', seconds: s.wait } };
  return err('unknown step');
}

export function applySteps(state: BoardState, steps: BoardStep[]): { state: BoardState; errors: string[] } {
  const errors: string[] = [];
  for (const step of steps) {
    const r = applyStep(state, step);
    if (r.effect.kind === 'error') errors.push(r.effect.message);
    state = r.state;
  }
  return { state, errors };
}

/** Compact description of the current page for Claude (board_state). */
export function describeBoard(state: BoardState) {
  const page = currentPage(state);
  return {
    page: { index: state.current, title: page.title, count: state.pages.length },
    shapes: page.order.map((id) => {
      const s = page.shapes[id];
      const out: Record<string, unknown> = { id, kind: s.kind };
      if (s.kind !== 'arrow') out.at = pxToGrid(s.x + s.w / 2, s.y + s.h / 2);
      for (const k of ['text', 'latex', 'label', 'from', 'to', 'style', 'source'] as const) if (s[k]) out[k] = s[k];
      if (s.code) out.code = s.code.length > 80 ? s.code.slice(0, 80) + '…' : s.code;
      if (s.faded) out.faded = true;
      if (s.user) out.user = true;
      return out;
    }),
  };
}

export function shapeLabel(s: Shape): string {
  return s.text ?? s.label ?? s.latex ?? s.title ?? (s.code ? s.code.split('\n')[0] : '') ?? s.id;
}

/** Arrow endpoint on the edge of a rect, pointing toward a target point. */
export function edgePoint(r: Rect, toward: { x: number; y: number }, round = false): { x: number; y: number } {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const dx = toward.x - cx, dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  if (round) {
    const rad = Math.min(r.w, r.h) / 2, len = Math.hypot(dx, dy);
    return { x: cx + (dx / len) * rad, y: cy + (dy / len) * rad };
  }
  const sx = (r.w / 2) / Math.abs(dx || 1e-9), sy = (r.h / 2) / Math.abs(dy || 1e-9);
  const t = Math.min(sx, sy);
  return { x: cx + dx * t, y: cy + dy * t };
}

export function arrowGeometry(page: BoardPage, a: Shape): { x1: number; y1: number; x2: number; y2: number } | null {
  const f = a.from ? page.shapes[a.from] : undefined;
  const t = a.to ? page.shapes[a.to] : undefined;
  const p1 = f ? { x: f.x + f.w / 2, y: f.y + f.h / 2 } : a.points?.[0] ? gridToPx(a.points[0]) : null;
  const p2 = t ? { x: t.x + t.w / 2, y: t.y + t.h / 2 } : a.points?.[1] ? gridToPx(a.points[1]) : null;
  if (!p1 || !p2) return null;
  const s = f ? edgePoint(f, p2, f.kind === 'circle') : p1;
  const e = t ? edgePoint(t, p1, t.kind === 'circle') : p2;
  // leave a small gap at the head
  const len = Math.hypot(e.x - s.x, e.y - s.y) || 1;
  const gap = 6;
  return { x1: s.x + ((e.x - s.x) / len) * gap, y1: s.y + ((e.y - s.y) / len) * gap, x2: e.x - ((e.x - s.x) / len) * gap, y2: e.y - ((e.y - s.y) / len) * gap };
}

/** Split narration into sentences so TTS can start early. */
export function splitSentences(text: string): string[] {
  const parts = text.replace(/\s+/g, ' ').trim().match(/[^.!?。！？]+(?:[.!?。！？]+["')\]]*|$)\s*/g) ?? [text];
  const out: string[] = [];
  for (const p of parts.map((x) => x.trim()).filter(Boolean)) {
    if (out.length && out[out.length - 1].length < 25) out[out.length - 1] += ' ' + p; else out.push(p);
  }
  return out;
}
