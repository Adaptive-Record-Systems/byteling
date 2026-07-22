import { base44 } from '@/api/base44Client';

/**
 * Thin wrappers over the Byteling backend (entities + functions), so the UI
 * doesn't sprinkle invoke() calls and entity names everywhere.
 *
 * base44.functions.invoke throws on non-2xx; the backend's JSON error/code live
 * on err.response.data. `errInfo` normalizes that for callers.
 */

export function errInfo(err) {
  const data = err?.response?.data;
  return {
    message: data?.error || err?.message || 'Something went wrong',
    code: data?.code || null
  };
}

// --- Bring-your-own-key (Anthropic) ---

export async function getProviderKey() {
  const rows = await base44.entities.ProviderKey.list('-created_date');
  return rows.find((r) => r.provider === 'anthropic') || null;
}

export async function setProviderKey(apiKey) {
  const res = await base44.functions.invoke('set-provider-key', {
    provider: 'anthropic',
    api_key: apiKey
  });
  return res.data; // { ok, provider, key_hint, status }
}

// --- GitHub connection ---

export async function getConnection() {
  const rows = await base44.entities.GitHubConnection.list('-created_date');
  return rows.find((r) => r.status === 'active') || null;
}

export async function startGithubConnect(returnPath = '/') {
  const res = await base44.functions.invoke('github-oauth-start', { return_path: returnPath });
  return res.data.authorize_url;
}

export async function disconnectGithub(connectionId) {
  return base44.entities.GitHubConnection.delete(connectionId);
}

// --- Repo reads ---

export async function listRepos() {
  const res = await base44.functions.invoke('github-repo', { action: 'list' });
  return res.data.repos; // [{ full_name, name, description, private, pushed_at }]
}

export async function getRepoTree(repoFullName) {
  const res = await base44.functions.invoke('github-repo', {
    action: 'tree',
    repo_full_name: repoFullName
  });
  return res.data; // { repo, ref, truncated, count, tree: [{path,type,size,sha}] }
}

export async function getRepoFiles(repoFullName, paths) {
  const res = await base44.functions.invoke('github-repo', {
    action: 'files',
    repo_full_name: repoFullName,
    paths
  });
  return res.data.files; // [{ path, ok, size, content?, error? }]
}

// --- Sessions & messages ---

export async function ensureSession(repoFullName, connectionId) {
  const existing = await base44.entities.Session.filter(
    { repo_full_name: repoFullName, status: 'active' },
    '-created_date',
    1
  );
  if (existing[0]) return existing[0];

  const me = await base44.auth.me();
  return base44.entities.Session.create({
    owner_email: me.email,
    repo_full_name: repoFullName,
    github_connection_id: connectionId,
    title: repoFullName,
    status: 'active'
  });
}

export async function loadMessages(sessionId) {
  return base44.entities.Message.filter({ session_id: sessionId }, 'sequence_number', 500);
}

// --- Chat ---

export async function sendChat({ sessionId, message, repoFullName, context }) {
  const res = await base44.functions.invoke('claude-chat', {
    session_id: sessionId,
    message,
    repo_full_name: repoFullName,
    context
  });
  return res.data; // { reply, session_id, sequence_number }
}
