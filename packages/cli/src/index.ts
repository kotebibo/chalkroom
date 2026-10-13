// chalkroom — create courses and start class.
import { mkdir, readFile, writeFile, readdir, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { slugify, now } from '@chalk/schema';

const here = dirname(fileURLToPath(import.meta.url));
const root = existsSync(join(here, '..', 'templates')) ? join(here, '..') : join(here, '..', '..', '..');
const TEMPLATE = join(root, 'templates', 'course');
const LIBRARY_TEMPLATE = join(root, 'templates', 'library');
const PLUGIN = process.env.CHALK_PLUGIN ?? 'chalkroom@chalkroom';

const home = () => resolve(process.env.CHALK_HOME ?? join(homedir(), 'chalkroom'));

function parseArgs(argv: string[]) {
  const pos: string[] = [];
  const opts: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=', 2);
      if (v !== undefined) opts[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) opts[k] = argv[++i];
      else opts[k] = true;
    } else pos.push(a);
  }
  return { pos, opts };
}

const HELP = `chalkroom — AI classroom for Claude Code

  chalkroom new "<title>" [--goal "..."] [--level beginner] [--language en] [--home <dir>]
      Create a course in <home>/courses/<id> (home defaults to ~/chalkroom or $CHALK_HOME).
  chalkroom start [course]  [--approved]
      Start Claude Code in the course with the Chalk channel. The browser opens.
  chalkroom serve [course]  [--mock] [--port 4747]
      UI only (reviews, replay) or with the scripted mock tutor.
  chalkroom list
      List courses in the library.
  chalkroom doctor
      Check Node, Claude Code and the library.

[course] is a folder path or a course id in the library; default: current folder.`;

async function ensureLibrary(lib: string) {
  await mkdir(join(lib, 'courses'), { recursive: true });
  for (const f of ['learner.md', 'settings.json', '.env.example']) {
    if (!existsSync(join(lib, f)) && existsSync(join(LIBRARY_TEMPLATE, f))) {
      await writeFile(join(lib, f), await readFile(join(LIBRARY_TEMPLATE, f)));
    }
  }
}

function fill(text: string, vars: Record<string, string>) {
  return text.replace(/\{\{(\w+)\}\}/g, (m, k) => vars[k] ?? m);
}

async function cmdNew(pos: string[], opts: Record<string, string | boolean>) {
  const title = pos.join(' ').trim();
  if (!title) throw new Error('Usage: chalkroom new "<title>" [--goal "..."]');
  const lib = resolve(String(opts.home ?? home()));
  await ensureLibrary(lib);
  const id = slugify(title);
  const dir = join(lib, 'courses', id);
  if (existsSync(join(dir, 'course.json'))) throw new Error(`Course already exists: ${dir}`);
  await mkdir(dir, { recursive: true });
  await cp(TEMPLATE, dir, { recursive: true });
  const vars = {
    title, id, goal: String(opts.goal ?? ''), level: String(opts.level ?? 'beginner'), language: String(opts.language ?? 'en'),
    date: now().slice(0, 10),
  };
  for (const f of ['CLAUDE.md', 'syllabus.md']) {
    const p = join(dir, f);
    if (existsSync(p)) await writeFile(p, fill(await readFile(p, 'utf8'), vars));
  }
  await writeFile(join(dir, 'course.json'), JSON.stringify({
    schema: 1, id, title, goal: vars.goal, level: vars.level, language: vars.language, resourcesOnly: false, created: now(), version: 1,
  }, null, 2) + '\n');
  for (const d of ['lessons', 'quizzes', 'flashcards', 'progress', 'resources/files', 'resources/extracted']) await mkdir(join(dir, d), { recursive: true });
  console.log(`Created ${dir}\n\nNext:\n  chalkroom start ${id}\n\nThen press "Draft syllabus" in the browser (or add resources first).`);
}

async function findCourse(arg?: string): Promise<string> {
  const candidates = arg ? [resolve(arg), join(home(), 'courses', arg)] : [process.cwd()];
  for (const c of candidates) if (existsSync(join(c, 'course.json'))) return c;
  throw new Error(arg ? `No course "${arg}" (looked in ${candidates.join(', ')})` : 'This folder is not a Chalkroom course. Pass a course id or run chalkroom new.');
}

// On Windows, claude is a .cmd shim that needs a shell; pass one quoted command string.
const WIN = process.platform === 'win32';
const quote = (a: string) => (/^[\w@:./=-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`);
const run = (args: string[], opts: Parameters<typeof spawn>[2] = {}) =>
  WIN ? spawn(['claude', ...args].map(quote).join(' '), { ...opts, shell: true }) : spawn('claude', args, opts);

function claudeVersion(): string | null {
  const r = WIN ? spawnSync('claude --version', { encoding: 'utf8', shell: true }) : spawnSync('claude', ['--version'], { encoding: 'utf8' });
  return r.status === 0 ? (/(\d+\.\d+\.\d+)/.exec(r.stdout)?.[1] ?? null) : null;
}

const atLeast = (v: string, min: string) => {
  const a = v.split('.').map(Number), b = min.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
};

async function cmdStart(pos: string[], opts: Record<string, string | boolean>) {
  const dir = await findCourse(pos[0]);
  const v = claudeVersion();
  if (!v) throw new Error('Claude Code (claude) was not found on PATH.');
  if (!atLeast(v, '2.1.80')) console.warn(`Claude Code ${v} has no channels; Chalk will run in terminal mode. Update with: claude update`);
  const flag = opts.approved ? '--channels' : '--dangerously-load-development-channels';
  const args = [flag, `plugin:${PLUGIN}`, ...pos.slice(1)];
  console.log(`Starting class in ${dir}\n  claude ${args.join(' ')}\n`);
  const p = run(args, { cwd: dir, stdio: 'inherit' });
  p.on('exit', (code) => process.exit(code ?? 0));
}

async function cmdServe(pos: string[], opts: Record<string, string | boolean>) {
  const dir = await findCourse(pos[0]);
  const server = join(here, 'server.mjs');
  const args = [server, opts.mock ? '--mock' : '--serve', '--course', dir];
  if (opts.port) args.push('--port', String(opts.port));
  if (opts['no-open']) args.push('--no-open');
  const p = spawn(process.execPath, args, { stdio: 'inherit' });
  p.on('exit', (code) => process.exit(code ?? 0));
}

async function cmdList() {
  const dir = join(home(), 'courses');
  const names = existsSync(dir) ? (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name) : [];
  if (!names.length) return console.log(`No courses in ${dir}. Create one: chalkroom new "Topic"`);
  for (const n of names) {
    try {
      const c = JSON.parse(await readFile(join(dir, n, 'course.json'), 'utf8'));
      console.log(`${n.padEnd(28)} ${c.title}${c.goal ? ` — ${c.goal}` : ''}`);
    } catch { /* not a course */ }
  }
}

async function cmdDoctor() {
  const ok = (b: boolean, msg: string) => console.log(`${b ? '✓' : '✗'} ${msg}`);
  const major = Number(process.versions.node.split('.')[0]);
  ok(major >= 20, `Node ${process.versions.node} (need 20+)`);
  const v = claudeVersion();
  ok(!!v && atLeast(v, '2.1.80'), v ? `Claude Code ${v} (channels need 2.1.80+)` : 'Claude Code not found on PATH');
  ok(existsSync(home()), `Library at ${home()}`);
  ok(existsSync(join(here, 'web', 'index.html')), 'UI build present');
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, opts } = parseArgs(rest);
  switch (cmd) {
    case 'new': return cmdNew(pos, opts);
    case 'start': return cmdStart(pos, opts);
    case 'serve': return cmdServe(pos, opts);
    case 'list': return cmdList();
    case 'doctor': return cmdDoctor();
    case undefined: case 'help': case '--help': case '-h': return console.log(HELP);
    default:
      // `chalk <course>` is shorthand for `chalkroom start <course>`
      return cmdStart([cmd, ...pos], opts);
  }
}

main().catch((e) => { console.error(`chalk: ${e.message}`); process.exit(1); });
