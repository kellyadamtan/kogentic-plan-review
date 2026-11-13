import * as vscode from 'vscode';

export const SECTION = 'kogenticPlanReview';

export function cfg(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(SECTION);
}

export function planGlobs(): string[] {
  const v = cfg().get<unknown>('planGlobs');
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
}

export function gatePort(): number {
  const p = cfg().get<number>('gate.port', 4815);
  return Number.isInteger(p) && p > 0 && p < 65536 ? p : 4815;
}

export function gateTimeoutSeconds(): number {
  const t = cfg().get<number>('gate.timeoutSeconds', 3600);
  return Number.isFinite(t) && t >= 10 ? Math.min(t, 86400) : 3600;
}
