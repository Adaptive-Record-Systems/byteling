import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

/**
 * Byteling — github-repo
 *
 * Read-only access to a connected GitHub repo, for feeding Claude context.
 * Must be called authenticated (widget or extension), via the SDK:
 *   base44.functions.invoke('github-repo', { action, repo_full_name, ... })
 *
 * Two actions:
 *   { action: 'tree',  repo_full_name, ref? }
 *       → recursive file tree (paths, type, size, sha) for the ref or default branch
 *   { action: 'files', repo_full_name, paths: string[], ref? }
 *       → decoded contents for up to MAX_FILES paths, with per-file status
 *
 * The GitHub token lives on the caller's GitHubConnection, which is field-locked
 * (access_token unreadable by clients). This function resolves it under the
 * service role *after* confirming the connection belongs to the authenticated
 * caller — so one user can never read through another user's token.
 *
 * This function only ever issues GET requests to GitHub. It never writes; the
 * PR-creation flow is a separate function.
 */

const MAX_FILES = 25;
const MAX_FILE_BYTES = 100_000; // 100 KB decoded cap per file
const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

function ghHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'byteling'
  };
}

/** base64 (GitHub contents API) → UTF-8 text, or null if the bytes aren't valid UTF-8. */
function decodeBase64Utf8(b64: string): { text: string | null; bytes: number } {
  const binary = atob(b64.replace(/\n/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { text, bytes: bytes.length };
  } catch {
    return { text: null, bytes: bytes.length }; // binary / non-UTF-8
  }
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

    const action = body.action;
    const repoFullName = body.repo_full_name;

    if (action !== 'tree' && action !== 'files' && action !== 'list') {
      return Response.json({ error: "action must be 'tree', 'files', or 'list'" }, { status: 400 });
    }
    // list needs no repo; tree/files require a valid owner/repo.
    if (action !== 'list' && (typeof repoFullName !== 'string' || !REPO_RE.test(repoFullName))) {
      return Response.json({ error: 'repo_full_name must be "owner/repo"' }, { status: 400 });
    }

    // Resolve the caller's own active connection under the service role. Filtering
    // by owner_email is what scopes the token to this user — never trust a
    // connection id from the request.
    const connections = await base44.asServiceRole.entities.GitHubConnection.filter({
      owner_email: user.email,
      status: 'active'
    });
    const connection = connections?.[0];
    if (!connection?.access_token) {
      return Response.json({ error: 'No active GitHub connection for this user' }, { status: 409 });
    }
    const token = connection.access_token;

    if (action === 'list') {
      // Repos the user can access — their own plus org repos (e.g. an approved
      // Adaptive-Record-Systems). Most-recently-pushed first, so the useful ones
      // surface. One page (100) is plenty for resolving "open my X app".
      const res = await fetch(
        'https://api.github.com/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member',
        { headers: ghHeaders(token) }
      );
      if (!res.ok) {
        return Response.json({ error: `GitHub repo list failed (${res.status})` }, { status: 502 });
      }
      const data = await res.json();
      const repos = (Array.isArray(data) ? data : []).map((r: Record<string, unknown>) => ({
        full_name: r.full_name,
        name: r.name,
        description: r.description ?? null,
        private: Boolean(r.private),
        pushed_at: r.pushed_at ?? null
      }));
      return Response.json({ count: repos.length, repos });
    }

    const [owner, repo] = repoFullName.split('/');

    // Resolve the ref: explicit ref wins, else the repo's default branch.
    let ref = typeof body.ref === 'string' && body.ref.trim() ? body.ref.trim() : null;
    if (!ref) {
      const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: ghHeaders(token)
      });
      if (!repoRes.ok) {
        return Response.json(
          { error: `GitHub repo lookup failed (${repoRes.status})` },
          { status: repoRes.status === 404 ? 404 : 502 }
        );
      }
      const repoData = await repoRes.json();
      ref = repoData.default_branch;
    }

    if (action === 'tree') {
      const treeRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
        { headers: ghHeaders(token) }
      );
      if (!treeRes.ok) {
        return Response.json(
          { error: `GitHub tree fetch failed (${treeRes.status})` },
          { status: treeRes.status === 404 ? 404 : 502 }
        );
      }
      const treeData = await treeRes.json();
      const entries = Array.isArray(treeData.tree) ? treeData.tree : [];
      return Response.json({
        repo: repoFullName,
        ref,
        truncated: Boolean(treeData.truncated),
        count: entries.length,
        tree: entries.map((e: Record<string, unknown>) => ({
          path: e.path,
          type: e.type, // 'blob' | 'tree'
          size: e.size ?? null,
          sha: e.sha
        }))
      });
    }

    // action === 'files'
    const paths = body.paths;
    if (!Array.isArray(paths) || paths.length === 0) {
      return Response.json({ error: 'paths must be a non-empty array' }, { status: 400 });
    }
    if (paths.length > MAX_FILES) {
      return Response.json({ error: `Too many paths; max ${MAX_FILES} per call` }, { status: 400 });
    }

    const files = await Promise.all(
      paths.map(async (p: unknown) => {
        if (typeof p !== 'string' || !p) {
          return { path: String(p), ok: false, error: 'Invalid path' };
        }
        // Encode each segment but keep the slashes.
        const encodedPath = p.split('/').map(encodeURIComponent).join('/');
        const res = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref!)}`,
          { headers: ghHeaders(token) }
        );
        if (!res.ok) {
          return { path: p, ok: false, status: res.status, error: `GitHub returned ${res.status}` };
        }
        const data = await res.json();
        if (Array.isArray(data)) {
          return { path: p, ok: false, error: 'Path is a directory, not a file' };
        }
        if (data.encoding !== 'base64' || typeof data.content !== 'string') {
          // Files >1MB come back without inline content.
          return { path: p, ok: false, size: data.size ?? null, error: 'File too large to inline' };
        }
        const { text, bytes } = decodeBase64Utf8(data.content);
        if (text === null) {
          return { path: p, ok: false, size: bytes, error: 'Binary or non-UTF-8 file' };
        }
        if (bytes > MAX_FILE_BYTES) {
          return {
            path: p,
            ok: true,
            truncated: true,
            size: bytes,
            content: text.slice(0, MAX_FILE_BYTES)
          };
        }
        return { path: p, ok: true, truncated: false, size: bytes, content: text };
      })
    );

    return Response.json({ repo: repoFullName, ref, files });
  } catch (error) {
    console.error('github-repo failed:', error);
    return Response.json({ error: 'Could not read repository' }, { status: 500 });
  }
});
