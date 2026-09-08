import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Config {
  roots: string[];
  hidden: string[];
  gitIntervalSec: number;
  remoteIntervalMin: number;
  gitlabHosts: string[];
}

const DEFAULTS: Config = {
  roots: ['~/Code'],
  hidden: [],
  gitIntervalSec: 15,
  remoteIntervalMin: 5,
  gitlabHosts: ['gitlab.shean.dev'],
};

export const CONFIG_PATH = process.env.KANCL_CONFIG ?? join(homedir(), '.config', 'kancl', 'config.json');

export function expandHome(p: string): string {
  return p.startsWith('~/') ? join(homedir(), p.slice(2)) : p === '~' ? homedir() : p;
}

/** Načte config; když neexistuje, založí ho s výchozími hodnotami. */
export function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) {
    mkdirSync(dirname(CONFIG_PATH), { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULTS, null, 2) + '\n');
    return { ...DEFAULTS };
  }
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    return { ...DEFAULTS, ...raw };
  } catch (e) {
    console.error(`[config] ${CONFIG_PATH} se nedá načíst, používám výchozí:`, e);
    return { ...DEFAULTS };
  }
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** GITLAB_TOKEN z prostředí, jinak z .env v kořeni repa Kanclu. */
export function gitlabToken(): string | undefined {
  if (process.env.GITLAB_TOKEN) return process.env.GITLAB_TOKEN;
  const env = join(REPO_ROOT, '.env');
  if (!existsSync(env)) return undefined;
  const m = readFileSync(env, 'utf8').match(/^\s*GITLAB_TOKEN\s*=\s*["']?([^"'\n]+)["']?\s*$/m);
  return m?.[1];
}
