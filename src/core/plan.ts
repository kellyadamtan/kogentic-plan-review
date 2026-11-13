import { parse as parseYaml } from 'yaml';
import { looksLikePath, normalizePath, sha256 } from './text';

export type Agent = 'claude-code' | 'cursor' | 'copilot' | 'generic';

export interface Todo {
  id: string;
  content: string;
  status: string; // pending | in-progress | completed | error | cancelled
}

export interface Plan {
  /** Stable id derived from the plan's location. */
  id: string;
  /** SHA-256 of the plan text; approvals are bound to it. */
  hash: string;
  /** Absolute path or URI string of the plan. */
  path: string;
  agent: Agent;
  title: string;
  overview?: string;
  todos: Todo[];
  steps: string[];
  /** Repo-relative (or absolute) file paths the plan mentions, sorted, de-duplicated. */
  files: string[];
  body: string;
  /** 1-based line where the body starts (after frontmatter). */
  bodyStartLine: number;
  frontmatterError?: string;
}

export interface ParseOptions {
  /** Force an agent (e.g. a Copilot plan opened from a chat session). */
  agent?: Agent;
  /** Folders treated as Claude Code plan folders (absolute, forward slashes). */
  claudePlanDirs?: string[];
}

export function detectAgent(path: string, opts: ParseOptions = {}): Agent {
  if (opts.agent) return opts.agent;
  const p = path.replace(/\\/g, '/');
  if (p.endsWith('.plan.md') || p.includes('/.cursor/plans/')) return 'cursor';
  if (p.includes('/.claude/plans/')) return 'claude-code';
  for (const d of opts.claudePlanDirs ?? []) {
    const dir = d.replace(/\\/g, '/').replace(/\/+$/, '') + '/';
    if (p.startsWith(dir)) return 'claude-code';
  }
  if (/\/\.github\/plans\//.test(p) || /copilot/i.test(p.split('/').pop() ?? '')) return 'copilot';
  return 'generic';
}

export function planId(path: string): string {
  return sha256(path.replace(/\\/g, '/')).slice(0, 16);
}

interface Frontmatter {
  data: Record<string, unknown>;
  body: string;
  bodyStartLine: number;
  error?: string;
}

export function splitFrontmatter(text: string): Frontmatter {
  const src = text.replace(/\r\n/g, '\n');
  if (!src.startsWith('---\n')) return { data: {}, body: src, bodyStartLine: 1 };
  const end = src.indexOf('\n---', 4);
  if (end < 0) return { data: {}, body: src, bodyStartLine: 1 };
  const after = src.indexOf('\n', end + 4);
  const raw = src.slice(4, end);
  const body = after < 0 ? '' : src.slice(after + 1);
  const bodyStartLine = raw.split('\n').length + 3;
  try {
    const data = parseYaml(raw);
    if (data === null || data === undefined) return { data: {}, body, bodyStartLine };
    if (typeof data !== 'object' || Array.isArray(data)) {
      return { data: {}, body, bodyStartLine, error: 'frontmatter is not a key: value mapping' };
    }
    return { data: data as Record<string, unknown>, body, bodyStartLine };
  } catch (e) {
    return { data: {}, body, bodyStartLine, error: (e as Error).message.split('\n')[0] };
  }
}

function asTodos(v: unknown): Todo[] {
  if (!Array.isArray(v)) return [];
  const out: Todo[] = [];
  v.forEach((t, i) => {
    if (t && typeof t === 'object') {
      const o = t as Record<string, unknown>;
      const content = typeof o.content === 'string' ? o.content : typeof o.title === 'string' ? o.title : '';
      if (!content) return;
      out.push({
        id: typeof o.id === 'string' || typeof o.id === 'number' ? String(o.id) : String(i + 1),
        content,
        status: typeof o.status === 'string' ? o.status : 'pending',
      });
    } else if (typeof t === 'string') {
      out.push({ id: String(i + 1), content: t, status: 'pending' });
    }
  });
  return out;
}

const FILES_HEADING = /^#{1,6}\s+.*\b(files?|paths?)\b.*\b(modif|chang|touch|creat|edit|add|updat|affect)/i;
const FILES_HEADING_2 = /^#{1,6}\s+(files|critical files|files to (modify|change|create|edit|touch)|affected files)\b/i;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/;
const BACKTICK = /`([^`\n]+)`/g;
const BARE_PATH = /(?:^|[\s(])((?:\.{0,2}\/)?[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]+)+\/?)(?=$|[\s),.;:])/g;

/** Extracts file paths mentioned in markdown (backticked or bare paths with a slash). */
export function extractFiles(markdown: string): string[] {
  const files = new Set<string>();
  let inFence = false;
  let inFilesSection = false;
  for (const line of markdown.split('\n')) {
    const t = line.trim();
    if (t.startsWith('```') || t.startsWith('~~~')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^#{1,6}\s/.test(t)) {
      inFilesSection = FILES_HEADING.test(t) || FILES_HEADING_2.test(t);
      continue;
    }
    for (const m of line.matchAll(BACKTICK)) {
      if (looksLikePath(m[1])) files.add(normalizePath(m[1]));
    }
    const noCode = line.replace(BACKTICK, ' ');
    for (const m of noCode.matchAll(BARE_PATH)) {
      if (looksLikePath(m[1])) files.add(normalizePath(m[1]));
    }
    if (inFilesSection) {
      const li = LIST_ITEM.exec(line);
      if (li) {
        const first = li[1].replace(/[*_]/g, '').split(/\s+[-–—:]\s+|\s+\(/)[0].trim();
        if (looksLikePath(first)) files.add(normalizePath(first));
      }
    }
  }
  return [...files].filter((f) => f.length > 0).sort();
}

function extractSteps(markdown: string): string[] {
  const steps: string[] = [];
  let inFence = false;
  for (const line of markdown.split('\n')) {
    const t = line.trim();
    if (t.startsWith('```') || t.startsWith('~~~')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = LIST_ITEM.exec(line);
    if (m && m[1].trim()) steps.push(m[1].trim());
  }
  return steps;
}

function firstHeading(markdown: string): string | undefined {
  for (const line of markdown.split('\n')) {
    const m = /^#{1,2}\s+(.+?)\s*#*\s*$/.exec(line.trim());
    if (m) return m[1];
  }
  return undefined;
}

/** Parses any supported plan file. */
export function parsePlan(text: string, path: string, opts: ParseOptions = {}): Plan {
  const fm = splitFrontmatter(text);
  const agent = detectAgent(path, opts);
  const name = typeof fm.data.name === 'string' ? fm.data.name : typeof fm.data.title === 'string' ? fm.data.title : undefined;
  const base = path.replace(/\\/g, '/').split('/').pop() ?? path;
  const title = (name ?? firstHeading(fm.body) ?? base.replace(/(\.plan)?\.md$/, '')).trim();
  const todos = asTodos(fm.data.todos);
  const overview = typeof fm.data.overview === 'string' ? fm.data.overview : undefined;
  const fileSources = [fm.body, overview ?? '', ...todos.map((t) => t.content)].join('\n');
  return {
    id: planId(path),
    hash: sha256(text.replace(/\r\n/g, '\n')),
    path,
    agent,
    title: title || base,
    overview,
    todos,
    steps: extractSteps(fm.body),
    files: extractFiles(fileSources),
    body: fm.body,
    bodyStartLine: fm.bodyStartLine,
    frontmatterError: fm.error,
  };
}
