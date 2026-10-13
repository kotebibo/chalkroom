// rough.js geometry as plain path data, memoised per shape so strokes do not
// re-jitter on every render.
import rough from 'roughjs';
import type { Options } from 'roughjs/bin/core';

const gen = rough.generator();
const cache = new Map<string, RPath[]>();

/** outline: the shape's stroke; sketch: hachure fill lines; solid: a filled area */
export interface RPath { d: string; kind: 'outline' | 'sketch' | 'solid' }

// Paths are coloured with CSS later; these sentinels only tell outline from fill.
export const FILL = '#f00';

export function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (Math.abs(h) % 2 ** 31) || 1;
}

function toPaths(drawable: ReturnType<typeof gen.rectangle>): RPath[] {
  return gen.toPaths(drawable).map((p) => ({
    d: p.d,
    kind: p.stroke === 'none' ? 'solid' : p.stroke === FILL ? 'sketch' : 'outline',
  }));
}

function memo(key: string, make: () => RPath[]): RPath[] {
  let v = cache.get(key);
  if (!v) {
    v = make();
    cache.set(key, v);
    if (cache.size > 3000) cache.delete(cache.keys().next().value!);
  }
  return v;
}

const base = (seed: number, o: Options = {}): Options => ({ seed, roughness: 1.1, bowing: 1.2, strokeWidth: 2, stroke: '#000', ...o });

export const rect = (id: string, x: number, y: number, w: number, h: number, o: Options = {}) =>
  memo(`r|${id}|${x}|${y}|${w}|${h}|${JSON.stringify(o)}`, () => toPaths(gen.rectangle(x, y, w, h, base(seedOf(id), o))));

export const ellipse = (id: string, cx: number, cy: number, w: number, h: number, o: Options = {}) =>
  memo(`e|${id}|${cx}|${cy}|${w}|${h}|${JSON.stringify(o)}`, () => toPaths(gen.ellipse(cx, cy, w, h, base(seedOf(id), o))));

export const line = (id: string, x1: number, y1: number, x2: number, y2: number, o: Options = {}) =>
  memo(`l|${id}|${x1}|${y1}|${x2}|${y2}|${JSON.stringify(o)}`, () => toPaths(gen.line(x1, y1, x2, y2, base(seedOf(id), o))));

export const curve = (id: string, pts: [number, number][], o: Options = {}) =>
  memo(`c|${id}|${pts.join(';')}|${JSON.stringify(o)}`, () => toPaths(gen.curve(pts, base(seedOf(id), { roughness: 0.6, ...o }))));

export const linear = (id: string, pts: [number, number][], o: Options = {}) =>
  memo(`p|${id}|${pts.join(';')}|${JSON.stringify(o)}`, () => toPaths(gen.linearPath(pts, base(seedOf(id), o))));
