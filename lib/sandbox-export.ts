// lib/sandbox-export.ts
// Extract a file-path → content map from a sandbox for PR commits.
//
// Strategy:
//   1. Initialize git inside the sandbox if not already a repo (template mode).
//   2. For repo mode: rely on the existing git history and use `git diff` to
//      find changed files vs. the base branch.
//   3. For template mode: treat every file not in .gitignore as "changed."
//
// We return { files, stats } so the PR body can include a meaningful summary.
import type { RunnerResult } from './sandbox-runner';

export interface ExportResult {
  files: Record<string, string>;        // path (repo-relative) → UTF-8 content
  stats: {
    added: number;
    modified: number;
    deleted: string[];                  // paths of deletions — PRs handle these differently
    totalBytes: number;
  };
}

const WORKDIR = '/vercel/sandbox';

// Paths we never commit, regardless of what the agent wrote.
const EXCLUDE_PATTERNS = [
  'node_modules/',
  '.next/',
  '.git/',
  'dist/',
  'build/',
  '.turbo/',
  '.vercel/',
  '.env',
  '.env.local',
  '.DS_Store',
];

function isExcluded(path: string): boolean {
  return EXCLUDE_PATTERNS.some((p) => path.includes(p));
}

/**
 * Extract changed files from a sandbox.
 *
 * @param runner   Active sandbox runner (the one the agent used).
 * @param mode     'repo' if the sandbox was seeded from git, 'template' otherwise.
 * @param baseRef  For repo mode, the branch/ref to diff against (default: origin/main).
 */
export async function exportChangedFiles(
  runner: RunnerResult,
  mode: 'repo' | 'template',
  baseRef = 'origin/main',
): Promise<ExportResult> {
  let changedPaths: string[];
  const deleted: string[] = [];

  if (mode === 'repo') {
    // Ensure we have the base ref locally.
    await runner.runCmd('pr_opening', 'git', ['fetch', 'origin', '--depth', '1']);
    const diff = await runner.runCmd('pr_opening', 'git', [
      'diff', '--name-status', baseRef, '--',
    ]);
    // Lines like: "M\tpath/to/file" or "A\tnew-file" or "D\tremoved"
    changedPaths = [];
    for (const line of diff.stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const [status, ...rest] = trimmed.split('\t');
      const path = rest.join('\t');
      if (!path || isExcluded(path)) continue;
      if (status.startsWith('D')) deleted.push(path);
      else changedPaths.push(path);
    }
  } else {
    // Template mode: list every tracked-or-untracked file except excludes.
    // We init a throwaway git repo inside the sandbox to use `git ls-files`.
    await runner.runCmd('pr_opening', 'bash', ['-lc',
      `cd ${WORKDIR} && (git rev-parse --git-dir >/dev/null 2>&1 || (git init -q && git add -A))`,
    ]);
    const ls = await runner.runCmd('pr_opening', 'bash', ['-lc',
      `cd ${WORKDIR} && git ls-files --cached --others --exclude-standard`,
    ]);
    changedPaths = ls.stdout
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s && !isExcluded(s));
  }

  // Read each file out of the sandbox. We cap at 200 files / 2MB each as a
  // guardrail; larger diffs probably shouldn't be a single PR anyway.
  const MAX_FILES = 200;
  const MAX_BYTES = 2 * 1024 * 1024;

  const files: Record<string, string> = {};
  let totalBytes = 0;
  let added = 0;
  let modified = 0;

  for (const rel of changedPaths.slice(0, MAX_FILES)) {
    const absPath = rel.startsWith('/') ? rel : `${WORKDIR}/${rel}`;
    try {
      const content = await runner.readFile(absPath);
      if (Buffer.byteLength(content, 'utf8') > MAX_BYTES) continue;
      files[rel] = content;
      totalBytes += content.length;

      if (mode === 'repo') {
        // We don't know add-vs-modify from the earlier parse cheaply; count as
        // modified and let the PR diff sort it out server-side.
        modified++;
      } else {
        added++;
      }
    } catch {
      // Binary/missing/permission — skip.
    }
  }

  return { files, stats: { added, modified, deleted, totalBytes } };
}
