import type { Plan } from './plan';
import { findVague } from './text';

export type Level = 'risk' | 'info' | 'ok';

export interface ChecklistItem {
  id: string;
  label: string;
  level: Level;
  detail: string;
}

export interface ChecklistResult {
  items: ChecklistItem[];
  risks: number;
}

/** Reports whether a repo-relative path exists. Injected so the checklist stays pure. */
export type ExistsFn = (relPath: string) => boolean;

const MIGRATION_FILE = /(^|\/)(migrations?|migrate|alembic|db\/migrate)\/|\.sql$|schema\.prisma$/i;
const MIGRATION_TEXT = /\b(migration|migrate|alter table|add column|drop column|schema change)\b/i;
const DELETE_TEXT = /\b(delete|deletes|deleting|remove|removes|removing|rename|renames|renaming|drop|drops|rm -rf|git rm)\b/i;
const DEP_FILE = /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|go\.mod|go\.sum|requirements[\w.-]*\.txt|pyproject\.toml|poetry\.lock|Pipfile(\.lock)?|Cargo\.(toml|lock)|Gemfile(\.lock)?|composer\.(json|lock)|build\.gradle(\.kts)?|pom\.xml)$/;
const DEP_TEXT = /\b(npm (install|i|add)|pnpm add|yarn add|pip install|go get|cargo add|add (a )?(new )?dependency|upgrade [\w@/-]+ to|bump [\w@/-]+)\b/i;
const INFRA_FILE = /(^|\/)(\.github\/workflows\/|\.gitlab-ci\.yml$|Dockerfile|docker-compose[\w.-]*\.ya?ml$|compose\.ya?ml$|k8s\/|kubernetes\/|helm\/|charts\/|terraform\/|[\w-]+\.tf$|Jenkinsfile$|\.circleci\/|vercel\.json$|netlify\.toml$|fly\.toml$)/;
const SECRET_FILE = /(^|\/)(\.env(\.[\w-]+)?|[\w.-]*\.pem|id_rsa|id_ed25519|credentials(\.json)?|secrets?(\.[\w]+)?)$/i;
const SECRET_TEXT = /(\.env\b|\bsecrets?\b|\bcredentials?\b|\bapi[ _-]?keys?\b|\bprivate keys?\b|\btokens?\b|\bpasswords?\b)/i;
const SECRET_EXAMPLE = /\.env\.(example|sample|template)$/;
const TEST_FILE = /(^|\/)(tests?|__tests__|spec)\/|[._-](test|spec)\.[\w]+$|_test\.go$|(^|\/)test_[\w]+\.py$/;
const TEST_TEXT = /\b(tests?|testing|unit test|integration test|e2e|spec)\b/i;

export const LONG_PLAN_STEPS = 30;
export const LONG_PLAN_LINES = 400;

function list(xs: string[], max = 5): string {
  const shown = xs.slice(0, max).map((x) => `\`${x}\``).join(', ');
  return xs.length > max ? `${shown} and ${xs.length - max} more` : shown;
}

/** Builds the heuristic risk checklist for a plan. */
export function buildChecklist(plan: Plan, exists: ExistsFn): ChecklistResult {
  const items: ChecklistItem[] = [];
  const text = [plan.title, plan.overview ?? '', plan.body, ...plan.todos.map((t) => t.content)].join('\n');
  const files = plan.files;

  const relFiles = files.filter((f) => !f.startsWith('/') && !f.startsWith('~'));
  const missing = relFiles.filter((f) => !exists(f));
  items.push({
    id: 'files',
    label: 'Files mentioned',
    level: files.length === 0 ? 'info' : 'ok',
    detail: files.length === 0
      ? 'The plan names no files. Ask the agent which files it will change.'
      : `${files.length} file(s): ${list(files)}` + (missing.length ? `. Not in the workspace yet (new, or a wrong path): ${list(missing)}.` : '.'),
  });
  if (missing.length) {
    items.push({ id: 'missing-files', label: 'Files that do not exist', level: 'info', detail: `${list(missing)}: check these are meant to be new files.` });
  }

  const migFiles = files.filter((f) => MIGRATION_FILE.test(f));
  if (migFiles.length || MIGRATION_TEXT.test(text)) {
    items.push({ id: 'migrations', label: 'Database migration', level: 'risk', detail: migFiles.length ? `Touches ${list(migFiles)}. Check it is reversible and safe on existing data.` : 'The plan mentions a schema change or migration. Check it is reversible and safe on existing data.' });
  }
  const del = DELETE_TEXT.exec(text);
  if (del) {
    items.push({ id: 'deletes', label: 'Deletes or renames', level: 'risk', detail: `The plan says "${del[0]}". Confirm nothing still depends on what is removed or renamed.` });
  }
  const depFiles = files.filter((f) => DEP_FILE.test(f));
  if (depFiles.length || DEP_TEXT.test(text)) {
    items.push({ id: 'dependencies', label: 'Dependency changes', level: 'risk', detail: depFiles.length ? `Touches ${list(depFiles)}. Review new packages and versions.` : 'The plan adds or upgrades a dependency. Review new packages and versions.' });
  }
  const infra = files.filter((f) => INFRA_FILE.test(f));
  if (infra.length) {
    items.push({ id: 'infra', label: 'CI or infrastructure files', level: 'risk', detail: `Touches ${list(infra)}.` });
  }
  const secretFiles = files.filter((f) => SECRET_FILE.test(f) && !SECRET_EXAMPLE.test(f));
  if (secretFiles.length || SECRET_TEXT.test(text.replace(/\.env\.(example|sample|template)\b/g, ''))) {
    items.push({ id: 'secrets', label: 'Secrets or .env', level: 'risk', detail: secretFiles.length ? `Touches ${list(secretFiles)}. Secrets must not be committed or printed.` : 'The plan mentions secrets, keys, tokens or passwords. Make sure none are committed or logged.' });
  }
  const testFiles = files.filter((f) => TEST_FILE.test(f));
  if (testFiles.length || TEST_TEXT.test(text)) {
    items.push({ id: 'tests', label: 'Tests', level: 'ok', detail: testFiles.length ? `Adds or changes tests: ${list(testFiles)}.` : 'The plan mentions tests.' });
  } else {
    items.push({ id: 'tests', label: 'Tests', level: 'risk', detail: 'The plan does not mention any tests. Ask how the change will be verified.' });
  }
  const vague = findVague(text);
  const lines = plan.body.split('\n').length;
  const steps = plan.todos.length || plan.steps.length;
  if (vague.length) {
    items.push({ id: 'vague', label: 'Vague steps', level: 'info', detail: `Phrases with no checkable outcome: ${vague.map((v) => `"${v}"`).join(', ')}.` });
  }
  if (steps > LONG_PLAN_STEPS || lines > LONG_PLAN_LINES) {
    items.push({ id: 'length', label: 'Long plan', level: 'info', detail: `${steps} steps, ${lines} lines. Consider splitting it into smaller plans.` });
  }
  if (plan.frontmatterError) {
    items.push({ id: 'frontmatter', label: 'Unreadable frontmatter', level: 'info', detail: plan.frontmatterError });
  }
  return { items, risks: items.filter((i) => i.level === 'risk').length };
}
