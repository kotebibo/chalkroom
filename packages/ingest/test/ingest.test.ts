import { describe, it, expect } from 'vitest';
import { extractPdf, htmlToText, chunkMarkdown, KnowledgeBase } from '../src/index';

/** A minimal two-page PDF with real text, built by hand so the test needs no fixtures. */
function tinyPdf(pages: string[]): Uint8Array {
  const objs: string[] = [];
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ');
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  pages.forEach((text, i) => {
    const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(out);
}

describe('ingest', () => {
  it('extracts PDF text per page', async () => {
    const r = await extractPdf(tinyPdf(['Program derived addresses', 'Bump seeds start at 255']));
    expect(r.pages).toBe(2);
    expect(r.chunks.map((c) => c.page)).toEqual([1, 2]);
    expect(r.chunks[1].text).toContain('Bump seeds');
  });

  it('turns HTML into Markdown-ish text without scripts or nav', () => {
    const r = htmlToText('<html><head><title>T &amp; U</title></head><body><nav>menu</nav><article><h2>Intro</h2><p>Hello <b>world</b></p><script>x()</script></article></body></html>');
    expect(r.title).toBe('T & U');
    expect(r.text).toContain('## Intro');
    expect(r.text).toContain('Hello world');
    expect(r.text).not.toContain('menu');
    expect(r.text).not.toContain('x()');
  });

  it('searches chunks with BM25 and prefix matching', () => {
    const kb = new KnowledgeBase();
    const chunks = chunkMarkdown('# PDAs\nDerived addresses.\n# CPI\nInvoke other programs with invoke_signed.');
    kb.addAll(chunks.map((c, i) => ({ ...c, id: `r:s:${i}`, resourceId: 'r' })));
    const hits = kb.search('invok');
    expect(hits[0].section).toBe('CPI');
    kb.removeResource('r');
    expect(kb.size).toBe(0);
  });
});
