// Chalk server entry. One process is three things at once:
//   - the plugin's MCP server (stdio) that Claude Code launches,
//   - a Claude Code channel that pushes learner input into the session,
//   - the local web server for the classroom UI.
//
// Modes:
//   (default)        MCP over stdio, launched by Claude Code
//   --serve          UI only, no tutor (reviews, replay, browsing)
//   --mock           UI + scripted mock tutor (UI development, tests)
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import type { Envelope } from '@chalk/schema';
import { MockTutor } from '@chalk/mock-tutor';
import { CourseStore, isCourseDir } from './course.js';
import { TurnManager } from './turns.js';
import { WebServer } from './web.js';
import { toolList, callTool, type ToolContext } from './tools.js';

const VERSION = '0.1.0';
const here = dirname(fileURLToPath(import.meta.url));
// stdout belongs to the MCP protocol; everything else goes to stderr
const log = (...a: unknown[]) => console.error('[chalk]', ...a);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(name);

const INSTRUCTIONS = `Chalk turns this session into a tutor with a whiteboard UI in the learner's browser.
Learner input arrives as <channel source="chalk" type="..."> events whose body is a JSON envelope, or as "userInput" inside a Chalk tool result.
Before teaching or handling any envelope, load the chalk-tutor skill (and chalk-board before drawing).
Reply only through Chalk tools (speak, chat_say, board_run, check_ask...) because the learner does not see terminal text, and end every turn with lesson_yield.
If a heartbeat arrives, call lesson_ack then lesson_yield.`;

async function main() {
  const mode = flag('--mock') ? 'mock' : flag('--serve') ? 'serve' : 'mcp';
  const courseDir = resolve(arg('--course') ?? process.env.CHALK_COURSE_DIR ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());

  if (mode === 'mcp' && !isCourseDir(courseDir)) {
    // Claude Code starts plugin servers in every project. Outside a course,
    // stay silent: no tools (no context cost), no web server, no browser.
    const idle = new Server({ name: 'chalk', version: VERSION }, { capabilities: { tools: {} } });
    idle.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
    await idle.connect(new StdioServerTransport());
    return;
  }
  if (!isCourseDir(courseDir)) {
    log(`Not a Chalkroom course folder: ${courseDir}\nCreate one with: chalkroom new "Topic"`);
    process.exit(1);
  }

  const store = new CourseStore(courseDir);
  const worker = join(here, 'pdf.worker.mjs');
  if (existsSync(worker)) store.pdfWorkerSrc = pathToFileURL(worker).href;
  await store.init();

  let deliver: (envs: Envelope[]) => Promise<void> = async () => {};
  let web: WebServer;
  const turns = new TurnManager({
    deliver: (envs) => deliver(envs),
    onState: (state) => web?.broadcast({ type: 'connection', state }),
    onDelivered: (via, count) => web?.broadcast({ type: 'delivered', via, count }),
    ackTimeoutMs: mode === 'mock' ? 5000 : 45_000,
  });

  web = new WebServer({
    store, turns, mock: mode === 'mock', log,
    webRoot: process.env.CHALK_WEB_ROOT ?? join(here, 'web'),
    port: Number(arg('--port') ?? process.env.CHALK_PORT ?? 4747),
  });
  const ctx: ToolContext = {
    store, turns,
    broadcast: (m) => web.broadcast(m),
    requestSnapshot: (ids) => web.requestSnapshot(ids),
  };
  const port = await web.listen();
  const url = `http://127.0.0.1:${port}`;

  if (mode === 'mcp') {
    const mcp = new Server(
      { name: 'chalk', version: VERSION },
      { capabilities: { tools: {}, experimental: { 'claude/channel': {} } }, instructions: INSTRUCTIONS },
    );
    mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolList() }));
    mcp.setRequestHandler(CallToolRequestSchema, async (req) => callTool(req.params.name, req.params.arguments, ctx) as any);
    deliver = async (envs) => {
      for (const env of envs) {
        await mcp.notification({
          method: 'notifications/claude/channel',
          params: { content: JSON.stringify(env), meta: { type: env.type, ...(env.lesson ? { lesson: env.lesson } : {}) } },
        });
      }
    };
    mcp.oninitialized = () => {
      log(`Chalkroom is open at ${url}`);
      setTimeout(() => turns.heartbeat().catch((e) => log('heartbeat failed', e)), 1500);
    };
    await mcp.connect(new StdioServerTransport());
    const shutdown = () => { web.close(); turns.dispose(); process.exit(0); };
    process.stdin.on('close', shutdown);
    process.on('SIGTERM', shutdown);
  } else if (mode === 'mock') {
    const tutor = new MockTutor((name, args) => callTool(name, args, ctx), { log, delayMs: Number(process.env.CHALK_MOCK_DELAY ?? 250) });
    deliver = async (envs) => { void tutor.handle(envs); };
    setTimeout(() => turns.heartbeat(), 300);
    console.log(`Chalkroom (mock tutor) is open at ${url}`);
  } else {
    turns.setConnection('disconnected');
    console.log(`Chalkroom (no tutor) is open at ${url}`);
  }

  if (!flag('--no-open') && !process.env.CHALK_NO_OPEN) {
    // Health checks (e.g. `claude mcp list`) start and stop the server within a
    // second; the process exits when stdin closes, so only real sessions get a tab.
    setTimeout(() => openBrowser(url), mode === 'mcp' ? 2500 : 0);
  }
}

function openBrowser(url: string) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    const p = spawn(cmd, args as string[], { stdio: 'ignore', detached: true, windowsHide: true });
    p.on('error', () => log(`Open ${url} in your browser.`));
    p.unref();
  } catch { log(`Open ${url} in your browser.`); }
}

main().catch((e) => { log(e); process.exit(1); });
