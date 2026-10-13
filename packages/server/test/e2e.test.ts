// End to end against the built bundle: Claude Code's side is played by an MCP
// client over stdio, the browser's side by a WebSocket client.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import WebSocket from 'ws';
import { request } from 'node:http';

const statusWithHost = (port: number, host: string) => new Promise<number>((res, rej) => {
  request({ host: '127.0.0.1', port, path: '/api/state', headers: { host } }, (r) => { r.resume(); res(r.statusCode ?? 0); }).on('error', rej).end();
});

const ROOT = resolve(__dirname, '../../..');
const BUNDLE = join(ROOT, 'dist/server.mjs');
const PORT = 4870 + Math.floor(Math.random() * 20);

const hasBundle = existsSync(BUNDLE);
let lib: string, client: Client, notes: { method: string; params: any }[], port = 0;

async function waitFor<T>(fn: () => T | undefined, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timed out');
}

describe.skipIf(!hasBundle)('chalk server bundle (MCP + channel + web)', () => {
  beforeAll(async () => {
    lib = await mkdtemp(join(tmpdir(), 'chalk-e2e-'));
    const course = join(lib, 'courses', 'solana-dev');
    await cp(join(ROOT, 'examples/courses/solana-dev'), course, { recursive: true });
    const transport = new StdioClientTransport({
      command: process.execPath, args: [BUNDLE],
      env: { ...process.env, CHALK_COURSE_DIR: course, CHALK_NO_OPEN: '1', CHALK_PORT: String(PORT) } as Record<string, string>,
      stderr: 'pipe',
    });
    let log = '';
    transport.stderr?.on('data', (d) => { log += String(d); });
    client = new Client({ name: 'e2e', version: '0' }, { capabilities: {} });
    notes = [];
    client.fallbackNotificationHandler = async (n) => { notes.push(n as any); };
    await client.connect(transport);
    port = Number(await waitFor(() => /127\.0\.0\.1:(\d+)/.exec(log)?.[1]));
  });

  afterAll(async () => {
    await client?.close();
    await rm(lib, { recursive: true, force: true });
  });

  it('declares the channel capability and sends a heartbeat', async () => {
    expect(client.getServerCapabilities()?.experimental?.['claude/channel']).toEqual({});
    const hb = await waitFor(() => notes.find((n) => n.method === 'notifications/claude/channel'));
    expect(JSON.parse(hb.params.content)).toMatchObject({ chalk: 1, type: 'heartbeat' });
    expect(hb.params.meta).toEqual({ type: 'heartbeat' });
    await client.callTool({ name: 'lesson_ack', arguments: {} });
    await client.callTool({ name: 'lesson_yield', arguments: {} });
  });

  it('routes browser input: channel when idle, tool result when busy', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: `http://127.0.0.1:${port}` });
    const msgs: any[] = [];
    ws.on('message', (d) => msgs.push(JSON.parse(String(d))));
    await waitFor(() => msgs.find((m) => m.type === 'hello'));
    expect(msgs[0].connection).toBe('connected');

    const before = notes.length;
    ws.send(JSON.stringify({ type: 'envelope', envelope: { chalk: 1, type: 'start_lesson', topic: 'pdas', mode: 'lecture' } }));
    const pushed = await waitFor(() => notes.slice(before).find((n) => n.params?.meta?.type === 'start_lesson'));
    expect(JSON.parse(pushed.params.content)).toMatchObject({ type: 'start_lesson', topic: 'pdas' });

    // Claude is mid-turn now: a question must come back in a tool result, not the channel
    await client.callTool({ name: 'lesson_start', arguments: { topicId: 'pdas' } });
    ws.send(JSON.stringify({ type: 'envelope', envelope: { chalk: 1, type: 'question', text: 'Why no key?' } }));
    await waitFor(() => msgs.find((m) => m.type === 'event' && m.event.kind === 'question'));
    const n = notes.length;
    const r: any = await client.callTool({ name: 'board_run', arguments: { steps: [{ add: { id: 'a', kind: 'box', text: 'A' } }, { say: 'Hi.' }] } });
    const all = r.content.map((c: any) => c.text).join('\n');
    expect(all).toContain('Why no key?');
    expect(all).toMatch(/"interrupt":true/);
    expect(notes.length).toBe(n);

    // the board event reached the browser
    await waitFor(() => msgs.find((m) => m.type === 'event' && m.event.kind === 'board_run'));
    const y: any = await client.callTool({ name: 'lesson_yield', arguments: {} });
    expect(JSON.parse(y.content[0].text)).toMatchObject({ idle: true });
    ws.close();
  });

  it('refuses foreign origins and hosts', async () => {
    const bad = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: 'https://evil.example' });
    await new Promise((res) => { bad.on('error', res); bad.on('close', res); });
    expect(await statusWithHost(port, `evil.example:${port}`)).toBe(421);
    expect(await statusWithHost(port, `127.0.0.1:${port}`)).toBe(200);
    const post = await fetch(`http://127.0.0.1:${port}/api/settings`, { method: 'PUT', headers: { origin: 'https://evil.example' }, body: '{}' });
    expect(post.status).toBe(403);
  });

  it('answers a board snapshot request through the browser', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: `http://127.0.0.1:${port}` });
    ws.on('message', (d) => {
      const m = JSON.parse(String(d));
      if (m.type === 'snapshot_request') ws.send(JSON.stringify({ type: 'snapshot_result', reqId: m.reqId, png: 'data:image/png;base64,iVBORw0KGgo=' }));
    });
    await new Promise((res) => ws.on('open', res));
    const r: any = await client.callTool({ name: 'board_snapshot', arguments: {} });
    expect(r.content[0]).toMatchObject({ type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=' });
    ws.close();
  });
});
