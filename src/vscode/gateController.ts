import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { addGate, hasGate, parseSettings, removeGate, stringifySettings } from '../gate/hookConfig';
import { GateServer, TOKEN_ENV, type GateDecision, type GateRequest } from '../gate/server';
import { gatePort, gateTimeoutSeconds } from './config';
import type { PlanRepository } from './planRepository';

export const PREVIEW_SCHEME = 'kogentic-preview';

/** Serves the read-only "before / after" documents for the settings diff. */
export class PreviewProvider implements vscode.TextDocumentContentProvider {
  private docs = new Map<string, string>();
  set(name: string, text: string): vscode.Uri {
    this.docs.set(name, text);
    return vscode.Uri.from({ scheme: PREVIEW_SCHEME, path: `/${name}` });
  }
  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.docs.get(uri.path.slice(1)) ?? '';
  }
}

function settingsFile(): string | undefined {
  const f = vscode.workspace.workspaceFolders?.[0];
  return f ? path.join(f.uri.fsPath, '.claude', 'settings.local.json') : undefined;
}

async function readText(file: string): Promise<string> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw e;
  }
}

/**
 * Runs the local gate server while the Claude Code hook is configured, and
 * turns a held ExitPlanMode request into a review in the panel.
 */
export class GateController implements vscode.Disposable {
  private server?: GateServer;
  private waiting = new Map<string, (d: GateDecision) => void>();
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly repo: PlanRepository,
    private readonly preview: PreviewProvider,
    private readonly openReview: (id: string) => void,
  ) {
    // The token is per session: never persisted across restarts.
    ctx.environmentVariableCollection.persistent = false;
  }

  dispose(): void {
    for (const r of this.waiting.values()) r({ allow: false, reason: 'VS Code closed before the plan was reviewed.' });
    this.waiting.clear();
    void this.server?.stop();
    this.emitter.dispose();
  }

  get running(): boolean {
    return !!this.server?.port;
  }

  info(): { running: boolean; port?: number; address?: string; url?: string; token?: string } {
    return { running: this.running, port: this.server?.port, address: this.server?.address, url: this.server?.url, token: this.server?.token };
  }

  isWaiting(id: string): boolean {
    return this.waiting.has(id);
  }

  /** Resolves a held Claude Code request for this plan, if there is one. */
  resolve(id: string, d: GateDecision): boolean {
    const r = this.waiting.get(id);
    if (!r) return false;
    this.waiting.delete(id);
    r(d);
    this.emitter.fire();
    return true;
  }

  /** Starts the server if the hook is already configured for this workspace. */
  async startIfConfigured(): Promise<void> {
    const file = settingsFile();
    if (!file) return;
    try {
      if (hasGate(parseSettings(await readText(file)))) await this.start();
    } catch (e) {
      void vscode.window.showWarningMessage(`Kogentic gate not started: ${(e as Error).message}`);
    }
  }

  async start(): Promise<void> {
    if (this.server) return;
    const server = new GateServer({ port: gatePort(), timeoutMs: gateTimeoutSeconds() * 1000, onPlan: (r, s) => this.onPlan(r, s) });
    try {
      await server.start();
    } catch (e) {
      throw new Error(`The Kogentic gate could not listen on 127.0.0.1:${gatePort()} (${(e as Error).message}). Change kogenticPlanReview.gate.port and try again.`, { cause: e });
    }
    this.server = server;
    const env = this.ctx.environmentVariableCollection;
    env.replace(TOKEN_ENV, server.token);
    env.description = 'Kogentic Plan Review: per-session token for the Claude Code plan gate';
    this.emitter.fire();
  }

  async stop(): Promise<void> {
    for (const r of this.waiting.values()) r({ allow: false, reason: 'The Kogentic gate was turned off.' });
    this.waiting.clear();
    await this.server?.stop();
    this.server = undefined;
    this.ctx.environmentVariableCollection.delete(TOKEN_ENV);
    this.emitter.fire();
  }

  private async onPlan(req: GateRequest, signal: AbortSignal): Promise<GateDecision> {
    const entry = await this.repo.addGatePlan(req.plan, req.planFilePath, req.sessionId);
    const id = entry.plan.id;
    this.waiting.get(id)?.({ allow: false, reason: 'A newer version of this plan was submitted.' });
    return new Promise<GateDecision>((resolve) => {
      this.waiting.set(id, resolve);
      signal.addEventListener('abort', () => {
        if (this.waiting.get(id) === resolve) {
          this.waiting.delete(id);
          this.emitter.fire();
        }
      });
      this.emitter.fire();
      this.openReview(id);
      void vscode.window.showInformationMessage(`Claude Code is waiting for approval of "${entry.plan.title}".`, 'Open review').then((c) => {
        if (c) this.openReview(id);
      });
    });
  }

  /** Shows the settings change as a diff, asks, then writes it. */
  async enable(): Promise<boolean> {
    const file = settingsFile();
    if (!file) throw new Error('Open a folder first: the gate is configured per workspace.');
    const before = await readText(file);
    const after = stringifySettings(addGate(parseSettings(before), gatePort(), gateTimeoutSeconds()));
    if (before === after) {
      await this.start();
      void vscode.window.showInformationMessage('The Claude Code gate is already enabled.');
      return true;
    }
    const left = this.preview.set('settings.local.before.json', before);
    const right = this.preview.set('settings.local.after.json', after);
    await vscode.commands.executeCommand('vscode.diff', left, right, '.claude/settings.local.json: proposed change');
    const ok = await vscode.window.showWarningMessage(
      'Write this hook into .claude/settings.local.json? Claude Code will then wait for your approval here before leaving plan mode. The gate listens on 127.0.0.1 only and requires a per-session token.',
      { modal: true },
      'Enable gate',
    );
    if (ok !== 'Enable gate') return false;
    await this.start();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, after, 'utf8');
    void vscode.window.showInformationMessage('Claude Code gate enabled. Restart Claude Code terminals opened before now so they get the token.');
    return true;
  }

  async disable(): Promise<void> {
    const file = settingsFile();
    if (file) {
      const before = await readText(file);
      if (before) {
        const s = parseSettings(before);
        if (hasGate(s)) await fs.writeFile(file, stringifySettings(removeGate(s)), 'utf8');
      }
    }
    await this.stop();
    void vscode.window.showInformationMessage('Claude Code gate disabled and the hook removed.');
  }
}
