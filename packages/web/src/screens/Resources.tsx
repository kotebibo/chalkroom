// Resources: add files and links, set roles, search, and view at a cited page.
import { useEffect, useRef, useState } from 'react';
import type { ResourceEntry } from '@chalk/schema';
import { api, type SearchHit } from '../api';
import { useStore } from '../store';
import { useData } from '../lib/hooks';

export function Resources() {
  const { data: list, reload } = useData(() => api.resources());
  const view = useStore((s) => s.resourceView);
  const app = useStore((s) => s.app);
  const toast = useStore((s) => s.toast);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = async (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      setBusy(`Extracting ${f.name}…`);
      try {
        const r = await api.upload(f);
        toast(`Added ${r.title} (${r.chunks} sections). Your tutor is reading it.`);
      } catch (e) { toast(`${f.name}: ${(e as Error).message}`, 'error'); }
    }
    setBusy(null);
    reload();
  };

  const addUrl = async () => {
    if (!url.trim()) return;
    setBusy(`Fetching ${url}…`);
    try { const r = await api.addUrl(url.trim()); toast(`Added ${r.title}.`); setUrl(''); } catch (e) { toast((e as Error).message, 'error'); }
    setBusy(null);
    reload();
  };

  const search = async () => { if (q.trim()) setHits(await api.search(q.trim())); };
  const resourcesOnly = !!app?.course?.resourcesOnly;

  if (view) return <ResourceViewer id={view.id} page={view.page} onBack={() => useStore.setState({ resourceView: null })} />;

  return (
    <div className="page-scroll">
      <div className="page">
        <div className="row"><h1 style={{ fontSize: 24 }}>Resources</h1><span className="spacer" />
          <label className="row" title="The tutor will only teach facts it can cite from these resources">
            <input type="checkbox" checked={resourcesOnly} onChange={async (e) => { await api.saveCourse({ resourcesOnly: e.target.checked }); void useStore.getState().refresh(); }} />
            Only use my resources
          </label>
        </div>
        <div className={`dropzone ${over ? 'over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) void upload(e.dataTransfer.files); }}>
          <div style={{ fontSize: 16, marginBottom: 6 }}>Drop PDFs, Word files, slides as PDF, Markdown, text or code here</div>
          <div className="row" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => fileRef.current?.click()}>Choose files</button>
            <span className="faint">or add a link</span>
            <input className="input" style={{ maxWidth: 340 }} placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addUrl()} />
            <button className="btn" disabled={!url.trim()} onClick={addUrl}>Add link</button>
          </div>
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => e.target.files && upload(e.target.files)} />
          {busy && <div className="faint" style={{ marginTop: 8 }}>{busy}</div>}
          <div className="faint" style={{ fontSize: 12.5, marginTop: 8 }}>Files are copied into this course's resources/ folder and never leave your machine except through Claude Code.</div>
        </div>
        <div className="row">
          <input className="input" placeholder="Search your resources…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
          <button className="btn" onClick={search}>Search</button>
        </div>
        {hits && (
          <div className="card">
            <div className="row"><h2 className="section-title" style={{ margin: 0 }}>{hits.length} results</h2><span className="spacer" /><button className="btn ghost small" onClick={() => setHits(null)}>✕</button></div>
            {hits.map((h) => (
              <button key={h.chunkId} className="list-item btn ghost" style={{ display: 'block', textAlign: 'left', width: '100%', whiteSpace: 'normal' }}
                onClick={() => useStore.setState({ resourceView: { id: h.resourceId, page: h.page, chunk: h.chunkId } })}>
                <b>{list?.find((r) => r.id === h.resourceId)?.title ?? h.resourceId}</b>{h.page ? ` · p${h.page}` : ''}{h.section ? ` · ${h.section}` : ''}
                <div className="muted" style={{ fontSize: 13.5 }}>{h.snippet}</div>
              </button>
            ))}
          </div>
        )}
        <div className="card">
          <div className="list">
            {(list ?? []).map((r) => <ResourceRow key={r.id} r={r} onChanged={reload} />)}
            {!list?.length && <div className="empty">No resources yet. Your tutor will teach from general knowledge until you add some.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function ResourceRow({ r, onChanged }: { r: ResourceEntry; onChanged: () => void }) {
  return (
    <div className="list-item" style={{ alignItems: 'flex-start' }}>
      <span style={{ fontSize: 20 }} aria-hidden>{({ pdf: '📕', docx: '📘', web: '🌐', markdown: '📝', code: '💻', image: '🖼️' } as Record<string, string>)[r.type] ?? '📄'}</span>
      <div className="grow">
        <button className="btn ghost" style={{ padding: 0, fontWeight: 700 }} onClick={() => useStore.setState({ resourceView: { id: r.id } })}>{r.title}</button>
        <div className="faint" style={{ fontSize: 12.5 }}>{r.type}{r.pages ? ` · ${r.pages} pages` : ''} · {r.chunks} sections · id <code>{r.id}</code></div>
        {r.summary ? <div className="muted" style={{ fontSize: 14, marginTop: 4 }}>{r.summary}</div> : <div className="faint" style={{ fontSize: 13, marginTop: 4 }}>Waiting for your tutor to summarise…</div>}
        {r.concepts.length > 0 && <div className="row" style={{ flexWrap: 'wrap', marginTop: 6 }}>{r.concepts.slice(0, 12).map((c) => <span key={c} className="chip">{c}</span>)}</div>}
      </div>
      <select className="select" style={{ width: 'auto' }} value={r.role} aria-label="Role" onChange={async (e) => { await api.setRole(r.id, e.target.value); onChanged(); }}>
        <option value="primary">Primary — teach from this</option>
        <option value="reference">Reference</option>
        <option value="exercise">Exercise source</option>
      </select>
      <button className="btn ghost small danger" onClick={async () => { if (confirm(`Remove ${r.title} from the index? The file stays in resources/files.`)) { await api.deleteResource(r.id); onChanged(); } }}>Remove</button>
    </div>
  );
}

function ResourceViewer({ id, page, onBack }: { id: string; page?: number; onBack: () => void }) {
  const { data: list } = useData(() => api.resources());
  const { data: chunks } = useData(() => api.chunks(id), [id]);
  const chunkId = useStore((s) => s.resourceView?.chunk);
  const r = list?.find((x) => x.id === id);
  const target = useRef<HTMLDivElement>(null);
  useEffect(() => { target.current?.scrollIntoView({ block: 'center' }); }, [chunks, page, chunkId]);
  if (list && !r) return <div className="page"><button className="btn" onClick={onBack}>← Resources</button><div className="empty">Unknown resource “{id}”.</div></div>;
  const hit = (c: { id: string; page?: number }) => (chunkId ? c.id === chunkId : page !== undefined && c.page === page);
  const firstHit = chunks?.findIndex(hit) ?? -1;
  return (
    <div className="page-scroll">
      <div className="page">
        <div className="row"><button className="btn" onClick={onBack}>← Resources</button><h1 style={{ fontSize: 20 }} className="grow">{r?.title ?? id}{page ? ` · page ${page}` : ''}</h1>
          {r && !/^https?:/.test(r.source) && <a className="btn" href={api.resourceFileUrl(r.id)} target="_blank" rel="noreferrer">Open file</a>}
          {r && /^https?:/.test(r.source) && <a className="btn" href={r.source} target="_blank" rel="noreferrer">Open link</a>}
        </div>
        <div className="viewer">
          <div className="scroll" style={{ maxHeight: '75vh' }}>
            {(chunks ?? []).map((c, i) => (
              <div key={c.id} ref={i === firstHit ? target : undefined} className={`chunk ${hit(c) ? 'hit' : ''}`}>
                <div className="faint" style={{ fontSize: 11.5, marginBottom: 4 }}>{c.page ? `p${c.page}` : c.section ?? ''} · {c.id}</div>
                {c.text.length > 900 && !hit(c) ? c.text.slice(0, 900) + '…' : c.text}
              </div>
            ))}
            {chunks && !chunks.length && <div className="empty">No extracted text (scanned or image file). Your tutor can read it directly.</div>}
          </div>
          <div>
            {r?.type === 'pdf' ? <iframe title={r.title} src={`${api.resourceFileUrl(r.id)}${page ? `#page=${page}` : ''}`} />
              : r?.type === 'image' ? <img src={api.resourceFileUrl(r.id)} alt={r.title} style={{ maxWidth: '100%', borderRadius: 10 }} />
              : <div className="card muted">{r?.summary ?? 'Text view on the left.'}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
