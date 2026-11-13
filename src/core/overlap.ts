export interface OverlapInput {
  id: string;
  title: string;
  files: string[];
  /** Only plans that are still open (pending or changes requested) are compared. */
  open: boolean;
}

export interface Overlap {
  otherId: string;
  otherTitle: string;
  files: string[];
}

function key(f: string): string {
  return f.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '').toLowerCase();
}

/** True if a and b are the same path, or one is a folder containing the other. */
export function pathsOverlap(a: string, b: string): boolean {
  const ka = key(a);
  const kb = key(b);
  if (!ka || !kb) return false;
  return ka === kb || kb.startsWith(ka + '/') || ka.startsWith(kb + '/');
}

/**
 * For each open plan, lists the other open plans that touch the same files
 * (or a file inside a folder the other plan names).
 */
export function computeOverlaps(plans: OverlapInput[]): Map<string, Overlap[]> {
  const open = plans.filter((p) => p.open && p.files.length > 0);
  const out = new Map<string, Overlap[]>();
  for (const p of plans) out.set(p.id, []);
  for (let i = 0; i < open.length; i++) {
    for (let j = i + 1; j < open.length; j++) {
      const a = open[i];
      const b = open[j];
      const shared = new Set<string>();
      for (const fa of a.files) {
        for (const fb of b.files) {
          if (pathsOverlap(fa, fb)) shared.add(key(fa).length >= key(fb).length ? fa : fb);
        }
      }
      if (shared.size === 0) continue;
      const files = [...shared].sort();
      out.get(a.id)!.push({ otherId: b.id, otherTitle: b.title, files });
      out.get(b.id)!.push({ otherId: a.id, otherTitle: a.title, files });
    }
  }
  return out;
}
