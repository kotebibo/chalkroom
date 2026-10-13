// Export the board as a standalone SVG or PNG. CSS variables do not survive
// outside the page, so computed colours and fonts are inlined into a clone.
import { BOARD_W, BOARD_H } from '@chalk/board';
import kalamUrl from '@fontsource/kalam/files/kalam-latin-400-normal.woff2?url';
import { player } from '../store';

const PROPS = ['fill', 'stroke', 'stroke-width', 'opacity', 'font-family', 'font-size', 'font-weight', 'color', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'background-color'];

let fontData: Promise<string> | null = null;
function kalamDataUrl() {
  fontData ??= fetch(kalamUrl).then((r) => r.blob()).then((b) => new Promise<string>((res) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.readAsDataURL(b);
  })).catch(() => '');
  return fontData;
}

function inline(src: Element, dst: Element) {
  const cs = getComputedStyle(src);
  const style: string[] = [];
  for (const p of PROPS) {
    const v = cs.getPropertyValue(p);
    if (v) style.push(`${p}:${v}`);
  }
  // finished drawing: no dash animation in the export
  if (src.classList.contains('stroke')) style.push('stroke-dasharray:none', 'stroke-dashoffset:0', 'animation:none');
  style.push('animation:none', 'transition:none');
  dst.setAttribute('style', style.join(';'));
  for (let i = 0; i < src.children.length; i++) inline(src.children[i], dst.children[i]);
}

export async function boardSvg(shapeIds?: string[], el = document.getElementById('chalk-board') as SVGSVGElement | null): Promise<string> {
  if (!el) throw new Error('board is not on screen');
  const clone = el.cloneNode(true) as SVGSVGElement;
  inline(el, clone);
  clone.querySelectorAll('.sel').forEach((n) => n.remove());
  let vb = `0 0 ${BOARD_W} ${BOARD_H}`;
  if (shapeIds?.length) {
    const page = player.state.pages[player.viewPage ?? player.state.current];
    const rs = shapeIds.map((id) => page.shapes[id]).filter(Boolean);
    if (rs.length) {
      const x = Math.min(...rs.map((r) => r.x)) - 24, y = Math.min(...rs.map((r) => r.y)) - 24;
      const w = Math.max(...rs.map((r) => r.x + r.w)) + 24 - x, h = Math.max(...rs.map((r) => r.y + r.h)) + 24 - y;
      vb = `${x} ${y} ${w} ${h}`;
    }
  }
  const [, , w, h] = vb.split(' ').map(Number);
  clone.setAttribute('viewBox', vb);
  clone.setAttribute('width', String(Math.round(w)));
  clone.setAttribute('height', String(Math.round(h)));
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.removeAttribute('class');
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--board').trim() || '#1f2b26';
  const font = await kalamDataUrl();
  const defs = `<style>${font ? `@font-face{font-family:'Kalam';src:url(${font}) format('woff2');}` : ''}</style><rect x="${vb.split(' ')[0]}" y="${vb.split(' ')[1]}" width="${w}" height="${h}" fill="${bg}"/>`;
  return new XMLSerializer().serializeToString(clone).replace(/^(<svg[^>]*>)/, `$1${defs}`);
}

export async function svgToPng(svg: string, scale = 1): Promise<string> {
  const vb = /viewBox="([^"]+)"/.exec(svg)?.[1].split(/\s+/).map(Number) ?? [0, 0, BOARD_W, BOARD_H];
  const img = new Image();
  img.decoding = 'async';
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('could not rasterise board')); img.src = url; });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vb[2] * scale);
    canvas.height = Math.round(vb[3] * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function snapshotPng(shapeIds?: string[]) {
  return svgToPng(await boardSvg(shapeIds), 1);
}

export function download(name: string, data: string | Blob) {
  const a = document.createElement('a');
  a.href = typeof data === 'string' ? data : URL.createObjectURL(data);
  a.download = name;
  a.click();
  if (typeof data !== 'string') setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
