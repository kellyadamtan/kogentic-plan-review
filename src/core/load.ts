export interface LoadedText {
  path: string;
  text: string;
}

export interface LoadError {
  path: string;
  message: string;
}

export interface LoadResult {
  loaded: LoadedText[];
  /** Files that were found but could not be read. Never dropped silently. */
  errors: LoadError[];
}

/** Reads every plan file; each failure is reported, not skipped. */
export async function readPlanFiles(paths: string[], read: (p: string) => Promise<string>): Promise<LoadResult> {
  const loaded: LoadedText[] = [];
  const errors: LoadError[] = [];
  for (const p of paths) {
    try {
      loaded.push({ path: p, text: await read(p) });
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      errors.push({ path: p, message: err.code ? `${err.code}: ${err.message}` : String(err.message ?? e) });
    }
  }
  return { loaded, errors };
}

/** One-line summary for a warning notification. */
export function loadErrorSummary(errors: LoadError[]): string | undefined {
  if (errors.length === 0) return undefined;
  const first = errors[0];
  const more = errors.length > 1 ? ` and ${errors.length - 1} more` : '';
  return `Kogentic Plan Review could not read ${errors.length} plan file${errors.length === 1 ? '' : 's'}: ${first.path} (${first.message})${more}.`;
}
