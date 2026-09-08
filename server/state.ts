import { basename } from 'node:path';
import type { Activity, Session, SessionStatus, TerminalInfo, ServerMessage } from '../shared/types.ts';

/** Payload posted by hook/comakers-hook.sh */
export interface HookPayload {
  hook: Record<string, any>;
  meta?: Partial<TerminalInfo> & { model?: string };
}

const NAMES = [
  'Ada', 'Bit', 'Cody', 'Dot', 'Echo', 'Fizz', 'Gus', 'Hex', 'Ivy', 'Jax',
  'Kit', 'Lex', 'Mo', 'Nova', 'Ox', 'Pip', 'Quin', 'Rex', 'Sol', 'Tux',
  'Uma', 'Vex', 'Wren', 'Xen', 'Yoshi', 'Zed', 'Bea', 'Cal', 'Dev', 'Eli',
  'Fox', 'Gem', 'Hal', 'Ike', 'Jo', 'Kai', 'Lu', 'Max', 'Nix', 'Ollie',
];
export const COLOR_COUNT = 10;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

const BUILD_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const CHOP_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch', 'ToolSearch']);
const RUN_TOOLS = new Set(['Bash', 'BashOutput', 'KillShell', 'KillBash']);
const ASK_TOOLS = new Set(['AskUserQuestion']);

export function activityForTool(tool?: string): Activity {
  if (!tool) return 'think';
  if (BUILD_TOOLS.has(tool)) return 'build';
  if (CHOP_TOOLS.has(tool)) return 'chop';
  if (RUN_TOOLS.has(tool)) return 'run';
  if (tool.startsWith('mcp__')) return 'chop';
  return 'lift';
}

function short(s: unknown, n = 60): string {
  if (typeof s !== 'string') return '';
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n - 1) + '…' : one;
}

function relPath(p: unknown, cwd: string): string {
  if (typeof p !== 'string') return '';
  return p.startsWith(cwd + '/') ? p.slice(cwd.length + 1) : p;
}

export function describeTool(tool: string, input: any, cwd: string): string {
  if (!input || typeof input !== 'object') return tool;
  switch (tool) {
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'Read':
    case 'NotebookEdit':
      return `${tool} ${relPath(input.file_path ?? input.notebook_path, cwd)}`;
    case 'Bash':
      return `Bash: ${short(input.description || input.command, 70)}`;
    case 'Grep':
      return `Grep /${short(input.pattern, 30)}/`;
    case 'Glob':
      return `Glob ${short(input.pattern, 40)}`;
    case 'WebFetch':
      return `Fetch ${short(input.url, 50)}`;
    case 'WebSearch':
      return `Search "${short(input.query, 40)}"`;
    case 'Agent':
    case 'Task':
      return `Agent: ${short(input.description, 50)}`;
    case 'AskUserQuestion':
      return 'Asking you a question';
    default:
      return tool;
  }
}

export class Store {
  sessions = new Map<string, Session>();
  listeners = new Set<(m: ServerMessage) => void>();
  serverStartedAt = Date.now();

  constructor(private opts: { maxEvents?: number } = {}) {}

  broadcast(m: ServerMessage) {
    for (const l of this.listeners) l(m);
  }

  list(): Session[] {
    return [...this.sessions.values()].sort((a, b) => a.startedAt - b.startedAt);
  }

  private pickName(id: string): { name: string; colorIndex: number } {
    const h = hash(id);
    const taken = new Set([...this.sessions.values()].filter(s => s.id !== id).map(s => s.name));
    let name = NAMES[h % NAMES.length];
    let i = 1;
    while (taken.has(name)) {
      name = NAMES[(h + i * 7) % NAMES.length];
      if (++i > NAMES.length) { name = `${NAMES[h % NAMES.length]}${i}`; break; }
    }
    return { name, colorIndex: h % COLOR_COUNT };
  }

  private ensure(id: string, hook: Record<string, any>, meta?: HookPayload['meta']): Session {
    let s = this.sessions.get(id);
    const now = Date.now();
    if (!s) {
      const cwd = typeof hook.cwd === 'string' ? hook.cwd : '';
      const { name, colorIndex } = this.pickName(id);
      s = {
        id, name, colorIndex, cwd,
        project: cwd ? basename(cwd) : 'unknown',
        status: 'idle', statusSince: now, activity: 'think',
        terminal: {}, startedAt: now, lastSeen: now,
        turns: 0, toolCalls: 0, subagents: 0, events: [],
      };
      this.sessions.set(id, s);
    }
    if (typeof hook.cwd === 'string' && hook.cwd !== s.cwd) {
      s.cwd = hook.cwd; s.project = basename(hook.cwd);
    }
    if (typeof hook.transcript_path === 'string') s.transcriptPath = hook.transcript_path;
    if (typeof hook.permission_mode === 'string') s.permissionMode = hook.permission_mode;
    if (meta) {
      const { model, ...term } = meta;
      for (const [k, v] of Object.entries(term)) {
        if (v !== undefined && v !== '' && v !== null) (s.terminal as any)[k] = v;
      }
      if (model) s.model = model;
    }
    s.lastSeen = now;
    return s;
  }

  private setStatus(s: Session, status: SessionStatus) {
    if (s.status !== status) {
      s.status = status;
      s.statusSince = Date.now();
    }
  }

  private log(s: Session, event: string, detail?: string) {
    s.events.push({ at: Date.now(), event, detail });
    const max = this.opts.maxEvents ?? 30;
    if (s.events.length > max) s.events.splice(0, s.events.length - max);
  }

  /** Apply a hook payload. Returns the session (or null if it was removed). */
  apply(payload: HookPayload): Session | null {
    const hook = payload.hook ?? {};
    const id = typeof hook.session_id === 'string' && hook.session_id ? hook.session_id : 'unknown';
    const ev: string = hook.hook_event_name ?? 'Unknown';

    if (ev === 'SessionEnd') {
      const existing = this.sessions.get(id);
      if (existing) {
        this.sessions.delete(id);
        this.broadcast({ type: 'remove', id, reason: hook.end_reason ?? hook.reason });
      }
      return null;
    }

    const s = this.ensure(id, hook, payload.meta);

    switch (ev) {
      case 'SessionStart':
        this.setStatus(s, 'idle');
        s.activity = 'think';
        this.log(s, ev, hook.startup_type ?? hook.source);
        break;

      case 'UserPromptSubmit':
        s.turns++;
        s.prompt = short(hook.user_prompt ?? hook.prompt, 120);
        s.message = undefined;
        s.activity = 'think';
        this.setStatus(s, 'working');
        this.log(s, ev, s.prompt);
        break;

      case 'PreToolUse': {
        const tool: string = hook.tool_name ?? '';
        s.toolCalls++;
        s.lastTool = tool;
        s.lastDetail = describeTool(tool, hook.tool_input, s.cwd);
        if (ASK_TOOLS.has(tool)) {
          s.message = short(hook.tool_input?.questions?.[0]?.question, 140) || 'Has a question for you';
          this.setStatus(s, 'waiting');
        } else {
          s.activity = activityForTool(tool);
          this.setStatus(s, 'working');
        }
        this.log(s, ev, s.lastDetail);
        break;
      }

      case 'PostToolUse': {
        const tool: string = hook.tool_name ?? s.lastTool ?? '';
        if (!ASK_TOOLS.has(tool)) {
          // Stay in the same zone; Claude is now thinking about the result.
          this.setStatus(s, 'working');
        } else {
          s.message = undefined;
          this.setStatus(s, 'working');
        }
        this.log(s, ev, tool);
        break;
      }

      case 'PostToolUseFailure': {
        const tool: string = hook.tool_name ?? '';
        s.message = short(hook.tool_error ?? hook.error ?? `${tool} failed`, 140);
        this.setStatus(s, 'error');
        this.log(s, ev, s.message);
        break;
      }

      case 'PermissionRequest': {
        const tool: string = hook.tool_name ?? '';
        s.lastTool = tool;
        s.lastDetail = describeTool(tool, hook.tool_input, s.cwd);
        s.message = `Allow ${s.lastDetail}?`;
        this.setStatus(s, 'permission');
        this.log(s, ev, s.lastDetail);
        break;
      }

      case 'Notification': {
        const kind: string = hook.notification_type ?? hook.type ?? '';
        const msg = short(hook.message, 160);
        if (kind === 'permission_prompt' || /permission/i.test(msg)) {
          s.message = msg || 'Needs your permission';
          this.setStatus(s, 'permission');
        } else if (kind === 'idle_prompt' || /waiting for your input/i.test(msg)) {
          if (s.status !== 'permission') {
            s.message = msg || 'Waiting for your input';
            this.setStatus(s, 'waiting');
          }
        } else if (kind === 'elicitation_dialog' || kind === 'agent_needs_input') {
          s.message = msg || 'Needs your input';
          this.setStatus(s, 'waiting');
        }
        this.log(s, ev, `${kind}${msg ? ': ' + msg : ''}`);
        break;
      }

      case 'Stop':
        s.message = short(hook.last_assistant_message, 160) || undefined;
        s.activity = 'think';
        this.setStatus(s, 'completed');
        this.log(s, ev, s.message ?? 'Turn finished');
        break;

      case 'SubagentStart':
        s.subagents++;
        this.setStatus(s, 'working');
        this.log(s, ev, short(hook.agent_type ?? hook.description, 60));
        break;

      case 'SubagentStop':
        s.subagents = Math.max(0, s.subagents - 1);
        this.log(s, ev);
        break;

      case 'PreCompact':
        s.lastDetail = 'Compacting context';
        this.setStatus(s, 'working');
        this.log(s, ev, hook.compact_reason ?? hook.trigger);
        break;

      default:
        this.log(s, ev);
    }

    this.broadcast({ type: 'upsert', session: s });
    return s;
  }

  remove(id: string, reason = 'dismissed') {
    if (this.sessions.delete(id)) this.broadcast({ type: 'remove', id, reason });
  }

  /**
   * Housekeeping: a `completed` agent that nobody talked to for a while becomes `waiting`
   * (it is, after all, waiting for you), a transient `error` returns to `working`, and
   * sessions whose claude process died are removed.
   */
  tick(isAlive: (pid: number) => boolean) {
    const now = Date.now();
    for (const s of this.sessions.values()) {
      let changed = false;
      if (s.status === 'completed' && now - s.statusSince > 3 * 60_000) {
        this.setStatus(s, 'waiting'); changed = true;
      }
      if (s.status === 'error' && now - s.statusSince > 20_000) {
        this.setStatus(s, 'working'); changed = true;
      }
      if (s.terminal.pid && now - s.lastSeen > 15_000 && !isAlive(s.terminal.pid)) {
        this.sessions.delete(s.id);
        this.broadcast({ type: 'remove', id: s.id, reason: 'process exited' });
        continue;
      }
      if (changed) this.broadcast({ type: 'upsert', session: s });
    }
  }
}
