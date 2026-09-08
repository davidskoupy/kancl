// Shared between server and client.

export type SessionStatus =
  | 'idle'        // just started, nothing happening yet
  | 'working'     // Claude is thinking / running tools
  | 'permission'  // Claude asked for permission (needs you)
  | 'waiting'     // Claude is waiting for your input (question / idle)
  | 'completed'   // Claude finished its turn (brings the result)
  | 'error';      // a tool failed / something went wrong

/** Where in the yard the agent works while `working`. */
export type Activity =
  | 'build'     // Edit / Write  -> workshop, hammering
  | 'chop'      // Read / Grep / Glob / Web* -> forest, chopping wood
  | 'run'       // Bash -> gym, treadmill
  | 'lift'      // Agent / Task / thinking -> gym, lifting
  | 'think';    // no tool yet (walking to the gym)

export interface TerminalInfo {
  program?: string;      // TERM_PROGRAM (Apple_Terminal, iTerm.app, vscode, WezTerm, ghostty ...)
  bundleId?: string;     // __CFBundleIdentifier
  tty?: string;          // /dev/ttys003
  termSessionId?: string;
  itermSessionId?: string;
  tmuxPane?: string;
  weztermPane?: string;
  kittyWindowId?: string;
  pid?: number;          // pid of the `claude` process
}

export interface SessionEvent {
  at: number;
  event: string;     // hook_event_name
  detail?: string;   // human readable
}

export interface Session {
  id: string;
  name: string;
  colorIndex: number;
  cwd: string;
  project: string;
  status: SessionStatus;
  statusSince: number;
  activity: Activity;
  lastTool?: string;
  lastDetail?: string;      // "Edit src/app.ts"
  message?: string;         // permission / notification message
  prompt?: string;          // last user prompt (short)
  permissionMode?: string;
  model?: string;
  terminal: TerminalInfo;
  startedAt: number;
  lastSeen: number;
  turns: number;
  toolCalls: number;
  subagents: number;
  transcriptPath?: string;
  events: SessionEvent[];
}

export type ServerMessage =
  | { type: 'snapshot'; sessions: Session[]; serverStartedAt: number }
  | { type: 'upsert'; session: Session }
  | { type: 'remove'; id: string; reason?: string }
  | { type: 'ping' };
