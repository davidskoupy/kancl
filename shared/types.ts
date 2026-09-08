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

export type Host = 'github' | 'gitlab' | 'none';
export type ProjectStatus = 'dotaz' | 'prace' | 'klid';

export interface Worktree {
  path: string;
  label: string;
  branch: string;
  dirty: number;
  ahead: number;
  behind: number;
  lastCommit?: { hash: string; message: string; at: number };  // at = epoch v sekundách (git %ct)
  dirtyOldest?: number;  // ms, mtime nejstarší necommitnuté změny
  merged?: boolean;      // HEAD je obsažený v hlavní větvi
  stale?: boolean;       // sloučené, > 14 dní bez commitu, projekt má víc worktree
  error?: string;
}

export interface MergeRequest {
  number: number;
  title: string;
  url: string;
  branch: string;
  state: 'open' | 'draft' | 'approved' | 'changes_requested';
  updatedAt: number;
}

export interface CiRun { name: string; title?: string; status: 'ok' | 'fail' | 'running'; at: number; url: string }
export interface CiState { status: 'ok' | 'fail' | 'running' | 'none'; name?: string; at?: number; url?: string; runs: CiRun[] }

export interface Project {
  id: string;            // normalizovaný remote (host/cesta) nebo absolutní cesta složky
  name: string;
  host: Host;
  remoteUrl?: string;
  worktrees: Worktree[];
  mrs: MergeRequest[];
  mrsError?: string;
  ci?: CiState;          // GitHub Actions: poslední běhy (jen čtení)
  group?: string;        // skupina z configu (Shean, Klienti, Weby…)
  groupIndex?: number;   // pořadí skupiny v configu (nezařazené = undefined → na konec)
  status: ProjectStatus; // odvozený ze sezení
  lastActivity: number;  // ms
  activeSince?: number;  // ms, start nejstaršího běžícího sezení (stabilní pořadí aktivních)
  scannedAt: number;
}

export interface Subagent { id: string; description: string; startedAt: number }

// ---- noční směna -----------------------------------------------------------
export type JobSource = 'claude' | 'routine' | 'cronjob';
export type JobState = 'spi' | 'bezi' | 'ok' | 'chyba' | 'vypnuto';

export interface JobRun { at: number; result: 'ok' | 'fail' | 'skip'; resultText: string; project?: string; slug?: string; note?: string }

export interface Job {
  id: string;
  source: JobSource;
  name: string;
  description?: string;
  schedule: string;        // cron, nebo prázdné u jednorázové
  scheduleHuman: string;   // "denně 7:00", "pondělí 6:00", "jednou 10. 9. 9:00"
  enabled: boolean;
  cwd?: string;
  projectId?: string;
  filePath?: string;
  fireAt?: number;
  lastRunAt?: number;
  nextRunAt?: number;
  lastResult?: JobRun;
  url?: string;            // routina: odkaz na claude.ai
  model?: string;
  state: JobState;
}

export interface Stock { engine: string; at: number; items: { project: string; pending: number; alarm: boolean }[] }

export interface CloudSession { id: string; name: string; kind: 'cloud' | 'remote-control'; status: 'idle' | 'working' | 'offline'; url?: string }

export interface NightShift {
  jobs: Job[];
  stock?: Stock;
  cloudSessions: CloudSession[];
  snapshotAt?: number;     // kdy vznikl ~/.kancl/cloud.json
  snapshotError?: string;
  scannedAt: number;
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
  project: string;          // název složky (basename cwd)
  title?: string;           // název sezení z desktopové aplikace Claude
  desktopId?: string;       // local_… pro deep link claude://code/continue?session=
  projectId?: string;       // Project.id, pokud cwd leží v naskenovaném projektu
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
  subagents: Subagent[];
  transcriptPath?: string;
  events: SessionEvent[];
}

export type ServerMessage =
  | { type: 'snapshot'; sessions: Session[]; projects: Project[]; night: NightShift; serverStartedAt: number }
  | { type: 'projects'; projects: Project[] }
  | { type: 'night'; night: NightShift }
  | { type: 'upsert'; session: Session }
  | { type: 'remove'; id: string; reason?: string }
  | { type: 'ping' };
