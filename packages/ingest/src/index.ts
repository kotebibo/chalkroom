// Resource extraction and keyword search. Runs in the Chalk server (Node).
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import MiniSearch from 'minisearch';

export interface Chunk { id: string; resourceId: string; page?: number; section?: string; text: string }
export interface Extracted { title?: string; pages?: number; chunks: Omit<Chunk, 'id' | 'resourceId'>[]; needsVision?: boolean }

const TEXT_EXT = new Set(['.md', '.markdown', '.txt', '.rst', '.csv', '.json', '.yaml', '.yml', '.toml',
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.py', '.rs', '.go', '.java', '.kt', '.c', '.h', '.cpp', '.hpp',
  '.cs', '.rb', '.php', '.swift', '.sol', '.sh', '.sql', '.css', '.scss', '.lua', '.zig', '.hs', '.ex']);
export const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

export function resourceType(file: string): string {
  const e = extname(file).toLowerCase();
  if (e === '.pdf') return 'pdf';
  if (e === '.docx') return 'docx';
  if (e === '.html' || e === '.htm') return 'html';
  if (e === '.md' || e === '.markdown') return 'markdown';
  if (IMAGE_EXT.has(e)) return 'image';
  if (TEXT_EXT.has(e)) return e === '.txt' ? 'text' : 'code';
  return 'other';
}

const MAX_CHUNK = 2400;

/** Split long text into chunks at paragraph boundaries. */
export function chunkText(text: string, base: { page?: number; section?: string } = {}): Extracted['chunks'] {
  const out: Extracted['chunks'] = [];
  let buf = '';
  for (const para of text.split(/\n{2,}/)) {
    if (buf && buf.length + para.length > MAX_CHUNK) { out.push({ ...base, text: buf.trim() }); buf = ''; }
    buf += para + '\n\n';
    while (buf.length > MAX_CHUNK * 1.5) { out.push({ ...base, text: buf.slice(0, MAX_CHUNK).trim() }); buf = buf.slice(MAX_CHUNK); }
  }
  if (buf.trim()) out.push({ ...base, text: buf.trim() });
  return out;
}

/** Split Markdown by headings into sections, then chunk each. */
export function chunkMarkdown(md: string): Extracted['chunks'] {
  const sections: { title?: string; body: string }[] = [{ body: '' }];
  for (const line of md.split(/\r?\n/)) {
    const h = /^#{1,3}\s+(.+)/.exec(line);
    if (h) sections.push({ title: h[1].trim(), body: line + '\n' });
    else sections[sections.length - 1].body += line + '\n';
  }
  return sections.filter((s) => s.body.trim()).flatMap((s) => chunkText(s.body, { section: s.title }));
}

export function htmlToText(html: string): { title?: string; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();
  let body = /<(article|main)[^>]*>([\s\S]*?)<\/\1>/i.exec(html)?.[2] ?? /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  body = body
    .replace(/<(script|style|noscript|svg|nav|footer|header|aside|form)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, n, t) => `\n\n${'#'.repeat(Math.min(3, Number(n)))} ${t}\n\n`)
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<(p|div|br|tr|section|pre|blockquote)[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '');
  const text = decodeEntities(body).replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*(\n\s*)+/g, '\n\n').trim();
  return { title: title ? decodeEntities(title) : undefined, text };
}

function decodeEntities(s: string) {
  return s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)));
}

export interface ExtractOptions { pdfWorkerSrc?: string }

export async function extractFile(path: string, opts: ExtractOptions = {}): Promise<Extracted> {
  const type = resourceType(path);
  if (type === 'pdf') return extractPdf(await readFile(path), opts);
  if (type === 'docx') {
    const mammoth = await import('mammoth');
    const { value } = await mammoth.convertToHtml({ path });
    return { chunks: chunkMarkdown(htmlToText(value).text) };
  }
  if (type === 'html') {
    const { title, text } = htmlToText(await readFile(path, 'utf8'));
    return { title, chunks: chunkMarkdown(text) };
  }
  if (type === 'markdown') return { chunks: chunkMarkdown(await readFile(path, 'utf8')) };
  if (type === 'text' || type === 'code') {
    const text = await readFile(path, 'utf8');
    return { chunks: type === 'code' ? chunkText('```' + extname(path).slice(1) + '\n' + text + '\n```') : chunkText(text) };
  }
  if (type === 'image') return { chunks: [], needsVision: true };
  throw new Error(`unsupported file type: ${extname(path) || path}`);
}

export async function extractPdf(data: Uint8Array, opts: ExtractOptions = {}): Promise<Extracted> {
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (opts.pdfWorkerSrc) pdfjs.GlobalWorkerOptions.workerSrc = opts.pdfWorkerSrc;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: true, isEvalSupported: false }).promise;
  const meta = await doc.getMetadata().catch(() => null);
  const chunks: Extracted['chunks'] = [];
  let chars = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let text = '';
    for (const item of content.items as any[]) {
      if (!('str' in item)) continue;
      text += item.str + (item.hasEOL ? '\n' : ' ');
    }
    text = text.replace(/[ \t]+/g, ' ').replace(/\n /g, '\n').trim();
    chars += text.length;
    if (text) chunks.push(...chunkText(text, { page: p }));
    page.cleanup();
  }
  const pages = doc.numPages;
  await doc.destroy();
  return { title: meta?.info?.Title || undefined, pages, chunks, needsVision: chars < pages * 40 };
}

export async function fetchUrl(url: string): Promise<Extracted & { html: string }> {
  const res = await fetch(url, { headers: { 'user-agent': 'Chalk/0.1 (+local study tool)' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`fetch failed: ${res.status} ${res.statusText}`);
  const html = await res.text();
  const { title, text } = htmlToText(html);
  return { title, html, chunks: chunkMarkdown(text) };
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export class KnowledgeBase {
  private ms = new MiniSearch<Chunk>({
    fields: ['text', 'section'],
    storeFields: ['resourceId', 'page', 'section'],
    searchOptions: { boost: { section: 2 }, prefix: true, fuzzy: 0.15, combineWith: 'OR' },
  });
  private chunks = new Map<string, Chunk>();

  clear() { this.ms.removeAll(); this.chunks.clear(); }

  addAll(chunks: Chunk[]) {
    const fresh = chunks.filter((c) => !this.chunks.has(c.id));
    for (const c of fresh) this.chunks.set(c.id, c);
    this.ms.addAll(fresh);
  }

  removeResource(resourceId: string) {
    for (const [id, c] of this.chunks) if (c.resourceId === resourceId) { this.ms.discard(id); this.chunks.delete(id); }
  }

  get size() { return this.chunks.size; }
  get(id: string) { return this.chunks.get(id); }

  search(query: string, limit = 8, resourceId?: string) {
    return this.ms.search(query, resourceId ? { filter: (r) => r.resourceId === resourceId } : undefined)
      .slice(0, limit)
      .map((r) => {
        const c = this.chunks.get(r.id)!;
        return { chunkId: c.id, resourceId: c.resourceId, page: c.page, section: c.section, score: Math.round(r.score * 100) / 100, snippet: snippet(c.text, r.terms) };
      });
  }
}

export function snippet(text: string, terms: string[], width = 220): string {
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of terms) { at = lower.indexOf(t.toLowerCase()); if (at >= 0) break; }
  const start = Math.max(0, at - width / 3);
  const s = text.slice(start, start + width).replace(/\s+/g, ' ').trim();
  return (start > 0 ? '…' : '') + s + (start + width < text.length ? '…' : '');
}
