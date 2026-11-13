import { existsSync, promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { buildChecklist, type ChecklistResult } from '../core/checklist';
import { readPlanFiles, type LoadError } from '../core/load';
import { computeOverlaps, type Overlap } from '../core/overlap';
import { parsePlan, type Agent, type Plan } from '../core/plan';
import { addComment, decide, deleteComment, isOpen, ReviewStore, type Review, type Status } from '../core/review';
import { cfg, planGlobs } from './config';

export interface PlanEntry {
  plan: Plan;
  review: Review;
  checklist: ChecklistResult;
  /** File URI, or undefined for a plan that only arrived through the gate. */
  uri?: vscode.Uri;
  source: 'workspace' | 'global' | 'gate';
}

const GLOBAL_LIMIT = 50;
const EXCLUDE = '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**}';

export function globalPlanDirs(): { dir: string; suffix: string }[] {
  const home = os.homedir();
  return [
    { dir: path.join(home, '.claude', 'plans'), suffix: '.md' },
    { dir: path.join(home, '.cursor', 'plans'), suffix: '.plan.md' },
  ];
}

async function readJson(file: string): Promise<Record<string, unknown> | undefined> {
  try {
    const v: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Claude Code `plansDirectory` settings for each workspace folder. */
export async function claudePlanDirs(folders: readonly vscode.WorkspaceFolder[]): Promise<string[]> {
  const out: string[] = [];
  for (const f of folders) {
    for (const name of ['settings.json', 'settings.local.json']) {
      const s = await readJson(path.join(f.uri.fsPath, '.claude', name));
      const d = s?.plansDirectory;
      if (typeof d === 'string' && d.trim()) {
        const abs = path.isAbsolute(d) ? d : path.join(f.uri.fsPath, d);
        if (!out.includes(abs)) out.push(abs);
      }
    }
  }
  return out;
}

async function listDir(dir: string, suffix: string, limit: number): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const files = await Promise.all(
    names.filter((n) => n.endsWith(suffix)).map(async (n) => {
      const p = path.join(dir, n);
      try {
        const st = await fs.stat(p);
        return st.isFile() ? { p, m: st.mtimeMs } : undefined;
      } catch {
        return undefined;
      }
    }),
  );
  return files.filter((x): x is { p: string; m: number } => !!x).sort((a, b) => b.m - a.m).slice(0, limit).map((x) => x.p);
}

/** Finds plans, keeps their reviews in sync and recomputes overlaps. */
export class PlanRepository implements vscode.Disposable {
  private entries = new Map<string, PlanEntry>();
  private overlapMap = new Map<string, Overlap[]>();
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private watchers: vscode.Disposable[] = [];
  private timer?: NodeJS.Timeout;
  private claudeDirs: string[] = [];
  private refreshing?: Promise<void>;
  private loadErrors: LoadError[] = [];

  constructor(readonly store: ReviewStore, private readonly reviewerFn: () => Promise<string>) {}

  dispose(): void {
    this.watchers.forEach((w) => w.dispose());
    this.emitter.dispose();
    if (this.timer) clearTimeout(this.timer);
  }

  all(): PlanEntry[] {
    return [...this.entries.values()].sort((a, b) => a.plan.title.localeCompare(b.plan.title));
  }

  get(id: string): PlanEntry | undefined {
    return this.entries.get(id);
  }

  byFsPath(fsPath: string): PlanEntry | undefined {
    const n = path.normalize(fsPath);
    return this.all().find((e) => e.uri && path.normalize(e.uri.fsPath) === n);
  }

  /** Plan files that were found but could not be read in the last scan. */
  errors(): LoadError[] {
    return this.loadErrors;
  }

  overlaps(id: string): Overlap[] {
    return this.overlapMap.get(id) ?? [];
  }

  pendingCount(): number {
    return this.all().filter((e) => isOpen(e.review)).length;
  }

  private exists = (rel: string): boolean => {
    for (const f of vscode.workspace.workspaceFolders ?? []) {
      if (existsSync(path.join(f.uri.fsPath, rel))) return true;
    }
    return false;
  };

  private async entryFor(text: string, p: string, source: PlanEntry['source'], uri?: vscode.Uri, agent?: Agent): Promise<PlanEntry> {
    const plan = parsePlan(text, p, { agent, claudePlanDirs: this.claudeDirs.map((d) => d.replace(/\\/g, '/')) });
    const review = await this.store.load(plan.id, plan.path, plan.hash);
    return { plan, review, checklist: buildChecklist(plan, this.exists), uri, source };
  }

  /** Tells listeners to re-render without rescanning. */
  notify(): void {
    this.emitter.fire();
  }

  private recompute(): void {
    this.overlapMap = computeOverlaps(this.all().map((e) => ({ id: e.plan.id, title: e.plan.title, files: e.plan.files, open: isOpen(e.review) })));
    this.emitter.fire();
  }

  /** Rescans all plan sources. */
  refresh(): Promise<void> {
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => (this.refreshing = undefined));
    }
    return this.refreshing;
  }

  private async doRefresh(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    this.claudeDirs = await claudePlanDirs(folders);
    const found = new Map<string, { uri: vscode.Uri; source: PlanEntry['source'] }>();
    const globs = planGlobs();
    if (folders.length && globs.length) {
      for (const f of folders) {
        const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(f, `{${globs.join(',')}}`), EXCLUDE, 500);
        for (const u of uris) found.set(u.fsPath, { uri: u, source: 'workspace' });
      }
    }
    for (const d of this.claudeDirs) {
      for (const p of await listDir(d, '.md', GLOBAL_LIMIT)) found.set(p, { uri: vscode.Uri.file(p), source: 'workspace' });
    }
    if (cfg().get<boolean>('includeGlobalPlans', true)) {
      for (const g of globalPlanDirs()) {
        for (const p of await listDir(g.dir, g.suffix, GLOBAL_LIMIT)) if (!found.has(p)) found.set(p, { uri: vscode.Uri.file(p), source: 'global' });
      }
    }
    const next = new Map<string, PlanEntry>();
    const { loaded, errors } = await readPlanFiles([...found.keys()], (p) => fs.readFile(p, 'utf8'));
    for (const { path: p, text } of loaded) {
      const { uri, source } = found.get(p)!;
      const e = await this.entryFor(text, p, source, uri);
      next.set(e.plan.id, e);
    }
    this.loadErrors = errors;
    for (const e of this.entries.values()) {
      if (e.source === 'gate' && !next.has(e.plan.id)) next.set(e.plan.id, e);
    }
    this.entries = next;
    this.resetWatchers(folders, globs);
    this.recompute();
  }

  private resetWatchers(folders: readonly vscode.WorkspaceFolder[], globs: string[]): void {
    this.watchers.forEach((w) => w.dispose());
    this.watchers = [];
    const patterns: vscode.GlobPattern[] = [];
    for (const f of folders) {
      if (globs.length) patterns.push(new vscode.RelativePattern(f, `{${globs.join(',')}}`));
      patterns.push(new vscode.RelativePattern(f, '.claude/settings*.json'));
    }
    for (const d of this.claudeDirs) patterns.push(new vscode.RelativePattern(vscode.Uri.file(d), '*.md'));
    if (cfg().get<boolean>('includeGlobalPlans', true)) {
      for (const g of globalPlanDirs()) if (existsSync(g.dir)) patterns.push(new vscode.RelativePattern(vscode.Uri.file(g.dir), `*${g.suffix}`));
    }
    for (const p of patterns) {
      const w = vscode.workspace.createFileSystemWatcher(p);
      const kick = () => this.scheduleRefresh();
      w.onDidCreate(kick);
      w.onDidChange(kick);
      w.onDidDelete(kick);
      this.watchers.push(w);
    }
  }

  scheduleRefresh(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), 300);
  }

  /** Adds a plan received by the Claude Code gate (text as sent by Claude). */
  async addGatePlan(text: string, planFilePath: string | undefined, sessionId: string | undefined): Promise<PlanEntry> {
    const p = planFilePath ?? `claude-gate:/${(sessionId ?? 'session').replace(/[^\w-]/g, '')}.md`;
    const uri = planFilePath && existsSync(planFilePath) ? vscode.Uri.file(planFilePath) : undefined;
    const e = await this.entryFor(text, p, uri ? (this.entries.get(this.idOf(p))?.source ?? 'gate') : 'gate', uri, 'claude-code');
    this.entries.set(e.plan.id, e);
    this.recompute();
    return e;
  }

  private idOf(p: string): string {
    return parsePlan('', p).id;
  }

  private async update(id: string, f: (r: Review, e: PlanEntry) => Review | Promise<Review>): Promise<PlanEntry> {
    const e = this.entries.get(id);
    if (!e) throw new Error('This plan is no longer available. Refresh the Plans view.');
    const review = await f(e.review, e);
    await this.store.save(review);
    const next = { ...e, review };
    this.entries.set(id, next);
    this.recompute();
    return next;
  }

  async decide(id: string, status: Status, reason?: string): Promise<PlanEntry> {
    const by = await this.reviewerFn();
    return this.update(id, (r, e) => decide(r, status, { planHash: e.plan.hash, by, reason: reason || undefined }));
  }

  comment(id: string, line: number, excerpt: string, text: string): Promise<PlanEntry> {
    return this.update(id, (r) => addComment(r, line, excerpt, text));
  }

  deleteComment(id: string, commentId: string): Promise<PlanEntry> {
    return this.update(id, (r) => deleteComment(r, commentId));
  }
}
