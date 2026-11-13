import * as path from 'node:path';
import * as vscode from 'vscode';
import { buildPlanPayload, connectorEnabled, ConnectorError, maskKey, SECRET_KEY, sendPlan, validateBaseUrl } from '../core/connector';
import { cfg } from './config';
import { headSha } from './git';
import type { PlanRepository } from './planRepository';

export type SendOutcome = 'disabled' | 'no-url' | 'no-key' | 'cancelled' | 'sent' | 'failed';

export function isConnectorOn(): boolean {
  return connectorEnabled(cfg().get<unknown>('kogentic.enabled'));
}

const OFF_MESSAGE = 'Sending to Kogentic is off. It is optional: set kogenticPlanReview.kogentic.enabled to true and kogenticPlanReview.kogentic.baseUrl to use it.';

export async function signIn(secrets: vscode.SecretStorage): Promise<boolean> {
  if (!isConnectorOn()) {
    void vscode.window.showInformationMessage(OFF_MESSAGE);
    return false;
  }
  const key = await vscode.window.showInputBox({
    title: 'Kogentic API key',
    prompt: 'Stored in VS Code SecretStorage on this machine. It is only sent to the base URL you configured, when you confirm a send.',
    password: true,
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim().length < 8 ? 'Enter the full API key.' : undefined),
  });
  if (!key) return false;
  await secrets.store(SECRET_KEY, key.trim());
  void vscode.window.showInformationMessage(`Kogentic API key saved (${maskKey(key.trim())}).`);
  return true;
}

export async function signOut(secrets: vscode.SecretStorage): Promise<void> {
  await secrets.delete(SECRET_KEY);
  void vscode.window.showInformationMessage('Kogentic API key removed from this machine.');
}

/** Shows exactly what would be sent, asks, and only then sends. */
export async function sendToKogentic(secrets: vscode.SecretStorage, repo: PlanRepository, id: string): Promise<SendOutcome> {
  if (!isConnectorOn()) {
    void vscode.window.showInformationMessage(OFF_MESSAGE);
    return 'disabled';
  }
  let base: string;
  try {
    base = validateBaseUrl(cfg().get<string>('kogentic.baseUrl'));
  } catch (e) {
    void vscode.window.showErrorMessage((e as Error).message);
    return 'no-url';
  }
  const key = await secrets.get(SECRET_KEY);
  if (!key) {
    void vscode.window.showErrorMessage('No Kogentic API key. Run "Kogentic: Sign In to Kogentic" first.');
    return 'no-key';
  }
  const e = repo.get(id);
  if (!e) throw new Error('This plan is no longer available.');
  const folder = vscode.workspace.workspaceFolders?.[0];
  const payload = buildPlanPayload(e.plan, e.checklist, { name: folder ? path.basename(folder.uri.fsPath) : 'unknown', sha: await headSha(folder?.uri.fsPath) });
  const doc = await vscode.workspace.openTextDocument({ language: 'json', content: JSON.stringify(payload, null, 2) + '\n' });
  await vscode.window.showTextDocument(doc, { preview: true });
  const ok = await vscode.window.showWarningMessage(
    `Send this plan (shown in the editor) to ${base}/v1/plans with key ${maskKey(key)}?`,
    { modal: true, detail: 'Only the JSON shown is sent. Nothing else is uploaded, and nothing is sent unless you choose Send.' },
    'Send',
  );
  if (ok !== 'Send') return 'cancelled';
  try {
    const r = await sendPlan(base, key, payload);
    void vscode.window.showInformationMessage(`Sent to Kogentic as ${r.plan_id}.${r.url ? ` ${r.url}` : ''}`);
    return 'sent';
  } catch (err) {
    void vscode.window.showErrorMessage(err instanceof ConnectorError ? err.message : `Send failed: ${(err as Error).message}`);
    return 'failed';
  }
}
