// Markdown from the tutor: sanitised, with KaTeX math and clickable citation chips.
import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import katex from 'katex';
import { useStore } from '../store';

marked.setOptions({ gfm: true, breaks: true });

const CITE = /\[\[res:([\w.-]+)(?:#p(\d+))?\]\]/g;

export function renderMarkdown(md: string): string {
  // protect math and citations from the Markdown parser
  const stash: string[] = [];
  const keep = (html: string) => `\u0000${stash.push(html) - 1}\u0000`;
  let src = md
    .replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex) => keep(katex.renderToString(tex, { displayMode: true, throwOnError: false })))
    .replace(/(^|[^\\$])\$([^$\n]+?)\$/g, (_m, pre, tex) => pre + keep(katex.renderToString(tex, { throwOnError: false })))
    .replace(CITE, (_m, id, page) => keep(`<button class="chip cite" data-res="${id}"${page ? ` data-page="${page}"` : ''}>📄 ${id}${page ? ` · p${page}` : ''}</button>`));
  src = marked.parse(src, { async: false }) as string;
  src = src.replace(/\u0000(\d+)\u0000/g, (_m, i) => stash[Number(i)]);
  return DOMPurify.sanitize(src, { ADD_ATTR: ['data-res', 'data-page'], ADD_TAGS: ['semantics', 'annotation'] });
}

export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return (
    <div
      className={`md ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const b = (e.target as HTMLElement).closest('[data-res]') as HTMLElement | null;
        if (!b) return;
        useStore.setState({ view: 'resources', resourceView: { id: b.dataset.res!, page: b.dataset.page ? Number(b.dataset.page) : undefined } });
      }}
    />
  );
}
