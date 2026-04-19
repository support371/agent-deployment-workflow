// lib/github.ts — open a PR with the agent's changes.
// We take a map of path→content and create a branch + single commit + PR.
// Binary files are unsupported in v1 (enough for agent output which is all text).
import { Octokit } from '@octokit/rest';
import { env, hasGitHub } from './env';

export interface PROptions {
  owner: string;
  repo: string;
  baseBranch?: string;
  headBranch: string;          // e.g. `gem-agent/2026-04-17-1234`
  title: string;
  body: string;
  files: Record<string, string>;
  /** Paths to delete from the base tree (repo-relative). */
  deleted?: string[];
}

export interface PRResult {
  url: string;
  number: number;
  headSha: string;
}

export async function openPullRequest(opts: PROptions): Promise<PRResult> {
  if (!hasGitHub()) throw new Error('GITHUB_TOKEN not configured');
  const token = env().GITHUB_TOKEN!;
  const gh = new Octokit({ auth: token });

  const base = opts.baseBranch ?? 'main';

  // 1. Resolve base commit sha.
  const { data: ref } = await gh.git.getRef({
    owner: opts.owner,
    repo: opts.repo,
    ref: `heads/${base}`,
  });
  const baseSha = ref.object.sha;

  // 2. Create feature branch off base.
  await gh.git.createRef({
    owner: opts.owner,
    repo: opts.repo,
    ref: `refs/heads/${opts.headBranch}`,
    sha: baseSha,
  });

  // 3. Build blobs for each file.
  const blobs = await Promise.all(
    Object.entries(opts.files).map(async ([path, content]) => {
      const { data } = await gh.git.createBlob({
        owner: opts.owner,
        repo: opts.repo,
        content: Buffer.from(content, 'utf8').toString('base64'),
        encoding: 'base64',
      });
      return { path, sha: data.sha };
    }),
  );

  // 4. Get base tree, layer our blobs on top.
  const { data: baseCommit } = await gh.git.getCommit({
    owner: opts.owner,
    repo: opts.repo,
    commit_sha: baseSha,
  });

  // GitHub's Tree API treats an entry with `sha: null` as a deletion from the
  // base tree — this is how we propagate agent-triggered deletions into the PR
  // instead of silently dropping them.
  const treeEntries: Array<{
    path: string;
    mode: '100644';
    type: 'blob';
    sha: string | null;
  }> = [
    ...blobs.map((b) => ({
      path: b.path,
      mode: '100644' as const,
      type: 'blob' as const,
      sha: b.sha,
    })),
    ...(opts.deleted ?? []).map((path) => ({
      path,
      mode: '100644' as const,
      type: 'blob' as const,
      sha: null,
    })),
  ];

  const { data: newTree } = await gh.git.createTree({
    owner: opts.owner,
    repo: opts.repo,
    base_tree: baseCommit.tree.sha,
    tree: treeEntries,
  });

  // 5. Commit.
  const { data: commit } = await gh.git.createCommit({
    owner: opts.owner,
    repo: opts.repo,
    message: opts.title,
    tree: newTree.sha,
    parents: [baseSha],
  });

  await gh.git.updateRef({
    owner: opts.owner,
    repo: opts.repo,
    ref: `heads/${opts.headBranch}`,
    sha: commit.sha,
  });

  // 6. PR.
  const { data: pr } = await gh.pulls.create({
    owner: opts.owner,
    repo: opts.repo,
    base,
    head: opts.headBranch,
    title: opts.title,
    body: opts.body,
  });

  return { url: pr.html_url, number: pr.number, headSha: commit.sha };
}
