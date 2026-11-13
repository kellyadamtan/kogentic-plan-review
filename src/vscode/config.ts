import * as vscode from 'vscode';

export const SECTION = 'kogenticPlanReview';

export function cfg(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(SECTION);
}

export function planGlobs(): string[] {
  const v = cfg().get<unknown>('planGlobs');
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
}
