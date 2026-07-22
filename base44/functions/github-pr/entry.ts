import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

/**
 * Byteling — github-pr
 *
 * Opens a pull request with a proposed fix. Must be called authenticated:
 *   base44.functions.invoke('github-pr', { repo_full_name, title, body, changes, base? })
 *
 * - changes: [{ path, content }] — full new content for each changed file
 * - base:    branch to target (defaults to the repo's default branch)
 *
 * This is the only function that writes to GitHub, and it only ever writes to a
 * NEW branch and opens a PR — never to the base branch directly. The user
 * reviews and merges the PR themselves. The token is resolved under the service
 * role after confirming the connection belongs to the caller.
 */

const MAX_FILES = 20;
const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

function ghHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'byteling'
  };
}

/** UTF-8 string → base64 (for the blob API). */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function slugify(s: string): string {
  return (s || 'fix')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'fix';
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me();
    if (!user?.email) {
      return Response.json({ error: 'Authentication required' }, { status: 401 });
    }

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'Expected a JSON body' }, { status: 400 });
    }

    const repoFullName = body.repo_full_name;
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const prBody = typeof body.body === 'string' ? body.body : '';
    const changes = body.changes;

    if (typeof repoFullName !== 'string' || !REPO_RE.test(repoFullName)) {
      return Response.json({ error: 'repo_full_name must be "owner/repo"' }, { status: 400 });
    }
    if (!title) {
      return Response.json({ error: 'A PR title is required' }, { status: 400 });
    }
    if (!Array.isArray(changes) || changes.length === 0) {
      return Response.json({ error: 'changes must be a non-empty array' }, { status: 400 });
    }
    if (changes.length > MAX_FILES) {
      return Response.json({ error: `Too many files; max ${MAX_FILES} per PR` }, { status: 400 });
    }
    for (const c of changes) {
      if (!c || typeof c.path !== 'string' || !c.path || typeof c.content !== 'string') {
        return Response.json({ error: 'each change needs a string path and content' }, { status: 400 });
      }
    }

    // Resolve the caller's own token under the service role.
    const connections = await base44.asServiceRole.entities.GitHubConnection.filter({
      owner_email: user.email,
      status: 'active'
    });
    const token = connections?.[0]?.access_token;
    if (!token) {
      return Response.json({ error: 'No active GitHub connection for this user' }, { status: 409 });
    }
    const [owner, repo] = repoFullName.split('/');
    const api = `https://api.github.com/repos/${owner}/${repo}`;
    const headers = ghHeaders(token);

    // Small helper: GitHub call that fails loudly with the step name.
    const gh = async (step: string, url: string, init?: RequestInit) => {
      const res = await fetch(url, { headers, ...init });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        console.error(`github-pr ${step} failed ${res.status}: ${detail.slice(0, 300)}`);
        throw { step, status: res.status };
      }
      return res.json();
    };

    // Base branch → its latest commit and tree.
    let base = typeof body.base === 'string' && body.base.trim() ? body.base.trim() : null;
    if (!base) {
      const repoData = await gh('repo-lookup', api);
      base = repoData.default_branch;
    }
    const baseRef = await gh('base-ref', `${api}/git/ref/heads/${encodeURIComponent(base)}`);
    const baseSha = baseRef.object.sha;
    const baseCommit = await gh('base-commit', `${api}/git/commits/${baseSha}`);
    const baseTreeSha = baseCommit.tree.sha;

    // A blob per changed file → a tree layered on the base tree.
    const tree = [];
    for (const c of changes) {
      const blob = await gh('blob', `${api}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify({ content: toBase64(c.content), encoding: 'base64' })
      });
      tree.push({ path: c.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    const newTree = await gh('tree', `${api}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({ base_tree: baseTreeSha, tree })
    });

    // One commit, on a fresh branch.
    const commit = await gh('commit', `${api}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({
        message: title,
        tree: newTree.sha,
        parents: [baseSha]
      })
    });
    const branch = `byteling/${slugify(title)}-${crypto.randomUUID().slice(0, 8)}`;
    await gh('create-ref', `${api}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha })
    });

    // Open the PR.
    const footer = '\n\n---\nProposed by Byteling. Review the diff before merging.';
    const pr = await gh('pull', `${api}/pulls`, {
      method: 'POST',
      body: JSON.stringify({
        title,
        head: branch,
        base,
        body: (prBody || '') + footer
      })
    });

    return Response.json({
      ok: true,
      pr_url: pr.html_url,
      number: pr.number,
      branch,
      base,
      files: changes.map((c: { path: string }) => c.path)
    });
  } catch (error) {
    const e = error as { step?: string; status?: number };
    if (e?.step) {
      const msg =
        e.status === 403 ? 'GitHub refused the write — the OAuth app may need org approval, or the token lacks write access.'
        : e.status === 404 ? 'Repo or base branch not found.'
        : e.status === 422 ? 'GitHub rejected the change — a branch or PR for this may already exist.'
        : `GitHub call failed at "${e.step}" (${e.status}).`;
      return Response.json({ error: msg }, { status: e.status === 403 || e.status === 404 || e.status === 422 ? e.status : 502 });
    }
    console.error('github-pr failed:', error);
    return Response.json({ error: 'Could not open the pull request' }, { status: 500 });
  }
});
