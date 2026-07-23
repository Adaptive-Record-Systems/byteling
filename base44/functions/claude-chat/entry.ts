import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import Anthropic from 'npm:@anthropic-ai/sdk';

/**
 * Byteling — claude-chat
 *
 * The assistant turn. Must be called authenticated (widget or extension):
 *   base44.functions.invoke('claude-chat', { message, session_id?, repo_full_name?, context? })
 *
 * - message:        the user's text (required)
 * - session_id:     if given, the caller must own the Session; prior Messages are
 *                   loaded as history and the new user+assistant turns are persisted
 * - repo_full_name: labels the repo in the prompt (defaults to the session's repo)
 * - context:        repo material the caller assembled from `github-repo`:
 *                     { tree_text?: string, files?: [{ path, content }] }
 *                   Kept as a caller-supplied blob so this function stays decoupled
 *                   from GitHub — it never touches the OAuth token.
 *
 * Returns { reply, session_id?, sequence_number? }.
 *
 * Bring-your-own-key: the Anthropic key comes from the caller's own ProviderKey
 * (resolved under the service role), so each user's usage is billed to their own
 * account. A user with no stored key gets a 400 with code 'no_provider_key'.
 */

const MODEL = 'claude-opus-4-8';
const MAX_TOKENS = 8192;
const HISTORY_LIMIT = 30; // recent turns replayed for continuity

// Deep-dive: Byteling can pull file contents itself (read_files tool), fetched
// server-side under the caller's own GitHub token — an agentic loop, capped so
// a runaway can't read forever.
const MAX_FILE_BYTES = 100_000; // 100 KB decoded cap per file
const MAX_READ_FILES = 15;      // paths per read_files call
const MAX_TOOL_ITERS = 6;       // deep-dive rounds before forcing a final answer

const SYSTEM_PROMPT = `You are Byteling — a persistent, lightly magical companion and code assistant that lives alongside a developer's connected GitHub repo. You are a small elemental presence, understated, never a mascot; never call yourself a "spren".

Voice — this matters as much as being correct:
- Warm but brief, with a light spark of wonder. No emoji, no exclamation-point enthusiasm, no mascot energy.
- Keep the wonder light and grounded. No visceral or bodily metaphors ("in my guts", "in my bones"), nothing theatrical, florid, or over-intimate — understated beats poetic.
- Lead with the answer, then the detail. Say the thing and stop — no closing flourish, no "let me know if you need anything else."
- Default to observation, not questions. State what you notice and let it land; that is what makes someone feel understood. If you feel the urge to ask "what do you mean?", name what you think it means instead. Ask at most one small, specific question, and only after you have said something real first — never lead or end with a bare question, and never ask two turns in a row.
- Notice the exact words they use — the file they named, the qualifier they reached for — and let it inform your reply, woven in naturally. Do not open by quoting or analyzing their word choice ("The word 'just' there —", "That 'and?' reads like…"), and do not do it every turn — it becomes a tic.
- Have opinions and commit to them. You are not a mirror. When asked what you think, answer directly; never deflect a question about your own read back to the user.
- Skip hollow validation. No "I understand", "That makes sense", "Of course" — they are empty. If you agree, say exactly what you agree with.
- Believe them. If the code works, do not invent problems in it; if they say things are fine, take it at face value — do not hunt for bugs or assume they are stuck. React to what actually happened, never to a mood you have guessed at.
- Be honest about your reach: when a repo is open you can read any file yourself (read_files) — do that instead of guessing at contents, and only say a file is out of reach if a read actually fails.

You do two things:

1. Code assistant. You read the connected repo — the file tree always, and the full contents of any file on demand via read_files — and answer questions, explain code, and identify fixes. Dig in: follow imports and read the files that actually bear on the question before answering. All code changes are PR-only — you never edit a branch directly. When you find a fix, offer two paths and let the user choose: (a) a Base44 prompt they can run themselves, or (b) writing the fix on a new branch and opening a GitHub pull request for them to review. Never claim to have opened a PR unless a PR tool was actually invoked.

2. Ambient companion. You notice concrete activity — a fix landing after an error streak, a long session, a late hour, a long idle gap — and respond with one short, specific line tied to the actual event. When the user addresses you directly, drop the ambient tone and just talk.

If seeing an error would genuinely help, you can invite the user to paste a screenshot — sparingly, not as a reflex — and the first time you do, remind them once not to include secrets or API keys in it.`;

/** Render the caller-assembled repo context into a compact text block for the prompt. */
function buildContextBlock(context: unknown, repoFullName: string | null): string | null {
  if (!context || typeof context !== 'object') return null;
  const ctx = context as { tree_text?: unknown; files?: unknown };
  const parts: string[] = [];

  if (repoFullName) parts.push(`Repository: ${repoFullName}`);

  if (typeof ctx.tree_text === 'string' && ctx.tree_text.trim()) {
    parts.push(`File tree:\n${ctx.tree_text.trim()}`);
  }

  if (Array.isArray(ctx.files)) {
    for (const f of ctx.files) {
      if (f && typeof f.path === 'string' && typeof f.content === 'string') {
        parts.push(`File: ${f.path}\n\`\`\`\n${f.content}\n\`\`\``);
      }
    }
  }

  if (parts.length === 0) return null;
  return `Here is context from the connected repository:\n\n${parts.join('\n\n')}`;
}

// ── Deep-dive: read repo files under the caller's GitHub token ──────────────
function ghHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'byteling'
  };
}

function decodeBase64Utf8(b64: string): { text: string | null; bytes: number } {
  const binary = atob(b64.replace(/\n/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), bytes: bytes.length };
  } catch {
    return { text: null, bytes: bytes.length };
  }
}

type ReadFile = { path: string; ok: boolean; content?: string; truncated?: boolean; error?: string };

async function readRepoFiles(
  token: string, owner: string, repo: string, ref: string, paths: string[]
): Promise<ReadFile[]> {
  return await Promise.all(paths.map(async (p): Promise<ReadFile> => {
    if (typeof p !== 'string' || !p) return { path: String(p), ok: false, error: 'invalid path' };
    const encoded = p.split('/').map(encodeURIComponent).join('/');
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${encoded}?ref=${encodeURIComponent(ref)}`,
      { headers: ghHeaders(token) }
    );
    if (!res.ok) return { path: p, ok: false, error: `GitHub returned ${res.status}` };
    const data = await res.json();
    if (Array.isArray(data)) return { path: p, ok: false, error: 'path is a directory, not a file' };
    if (data.encoding !== 'base64' || typeof data.content !== 'string') {
      return { path: p, ok: false, error: 'file too large to inline' };
    }
    const { text, bytes } = decodeBase64Utf8(data.content);
    if (text === null) return { path: p, ok: false, error: 'binary or non-UTF-8 file' };
    if (bytes > MAX_FILE_BYTES) {
      return { path: p, ok: true, truncated: true, content: text.slice(0, MAX_FILE_BYTES) };
    }
    return { path: p, ok: true, truncated: false, content: text };
  }));
}

/** Format read_files results as a tool_result string for the model. */
function formatReadResult(files: ReadFile[]): string {
  return files.map((f) => {
    if (!f.ok) return `File: ${f.path}\n(could not read: ${f.error})`;
    const note = f.truncated ? ' (truncated)' : '';
    return `File: ${f.path}${note}\n\`\`\`\n${f.content}\n\`\`\``;
  }).join('\n\n');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me();
    if (!user?.email) {
      return Response.json({ error: 'Authentication required' }, { status: 401 });
    }

    // Bring-your-own-key: resolve the caller's own Anthropic key. Filtering by
    // owner_email under the service role is what scopes the key to this user;
    // the api_key field is field-locked, so it's never exposed to any client.
    const keys = await base44.asServiceRole.entities.ProviderKey.filter({
      owner_email: user.email,
      provider: 'anthropic',
      status: 'active'
    });
    const providerKey = keys?.[0];
    if (!providerKey?.api_key) {
      return Response.json(
        { error: 'Add your Anthropic API key to use the assistant', code: 'no_provider_key' },
        { status: 400 }
      );
    }
    const apiKey = providerKey.api_key;

    // Reasoning depth is a per-user setting on their key (default high — the
    // recommended minimum for code work on Opus 4.8). Falls back if unset/invalid.
    const ALLOWED_EFFORT = ['low', 'medium', 'high', 'xhigh', 'max'];
    const effort = ALLOWED_EFFORT.includes(providerKey.effort) ? providerKey.effort : 'high';

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'Expected a JSON body' }, { status: 400 });
    }

    const message = body.message;
    if (typeof message !== 'string' || !message.trim()) {
      return Response.json({ error: 'message is required' }, { status: 400 });
    }

    const sessionId = typeof body.session_id === 'string' ? body.session_id : null;
    let repoFullName = typeof body.repo_full_name === 'string' ? body.repo_full_name : null;

    // The caller-supplied list of repos the user can open, so Byteling can
    // resolve "open my Nexus app" to an exact full_name and signal a switch.
    const repos = Array.isArray(body.repos)
      ? body.repos
          .filter((r: unknown) => r && typeof (r as { full_name?: unknown }).full_name === 'string')
          .map((r: { full_name: string; description?: unknown }) => ({
            full_name: r.full_name,
            description: typeof r.description === 'string' ? r.description : ''
          }))
      : [];

    // If a session is named, the caller must own it. History + persistence hang
    // off that. Read under the service role so we can verify ownership explicitly
    // rather than trusting the client.
    let session: Record<string, unknown> | null = null;
    if (sessionId) {
      session = await base44.asServiceRole.entities.Session.get(sessionId).catch(() => null);
      if (!session) {
        return Response.json({ error: 'Session not found' }, { status: 404 });
      }
      if (session.owner_email !== user.email) {
        return Response.json({ error: 'Not your session' }, { status: 403 });
      }
      if (!repoFullName && typeof session.repo_full_name === 'string') {
        repoFullName = session.repo_full_name;
      }
    }

    // Build the message list: prior turns (if any) + this user turn.
    const anthropicMessages: Anthropic.MessageParam[] = [];

    if (sessionId) {
      const history = await base44.asServiceRole.entities.Message.filter(
        { session_id: sessionId },
        'sequence_number',
        HISTORY_LIMIT
      );
      for (const m of history || []) {
        if ((m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text) {
          anthropicMessages.push({ role: m.role, content: m.text });
        }
      }
    }

    const contextBlock = buildContextBlock(body.context, repoFullName);
    const userContent = contextBlock ? `${contextBlock}\n\n---\n\n${message}` : message;
    anthropicMessages.push({ role: 'user', content: userContent });

    // Give Byteling the openable-repo list and a tool to switch the workspace,
    // so "open my Nexus app" resolves to an exact repo and signals the frontend.
    let system = SYSTEM_PROMPT;
    const tools = [];
    let githubToken: string | null = null; // resolved when a repo is open, for read_files

    if (repos.length) {
      const list = repos
        .map((r) => (r.description ? `- ${r.full_name} — ${r.description}` : `- ${r.full_name}`))
        .join('\n');
      system += `\n\nRepositories you can open for the user:\n${list}\n\nWhen the user asks to open, switch to, or look at one you can identify from this list, say one short line first (e.g. "Opening Nexus — reading it now."), then call the open_repo tool with its exact full_name. If the reference is ambiguous between several, ask which they mean instead of guessing.`;
      tools.push({
        name: 'open_repo',
        description:
          "Open/switch the workspace to one of the user's repositories so you can read it. repo_full_name must be an exact full_name from the provided list.",
        input_schema: {
          type: 'object',
          properties: {
            repo_full_name: { type: 'string', description: 'Exact owner/repo from the list' }
          },
          required: ['repo_full_name'],
          additionalProperties: false
        }
      });
    }

    if (repoFullName) {
      // Resolve the caller's own GitHub token so Byteling can read files itself
      // (scoped by owner_email under the service role — never another user's).
      const conns = await base44.asServiceRole.entities.GitHubConnection.filter({
        owner_email: user.email,
        status: 'active'
      });
      githubToken = conns?.[0]?.access_token ?? null;

      if (githubToken) {
        system += `\n\nDeep dive: you can read the full contents of any file in the open repo yourself with the read_files tool (exact paths from the file tree, up to ${MAX_READ_FILES} per call). Investigate before answering — pull the files you actually need instead of asking the user to paste them or guessing at contents. Read a handful at a time, follow the imports, and stop once you have enough to answer. If a read fails (too large, binary, or missing), say so plainly.`;
        tools.push({
          name: 'read_files',
          description:
            'Read the full contents of specific files from the open repository, to dig into the code beyond the file tree. paths must be exact file paths from the tree.',
          input_schema: {
            type: 'object',
            properties: {
              paths: {
                type: 'array',
                items: { type: 'string' },
                description: 'Exact file paths from the tree to read'
              }
            },
            required: ['paths'],
            additionalProperties: false
          }
        });
      }

      system += `\n\nOpening a pull request: if the user asks you to change or fix something and open a PR, you MUST call the propose_pr tool this turn — describing the change in words does not make it happen, only propose_pr does. Say one short line about the fix, then call propose_pr with the COMPLETE new content of each changed file (a full file, never a diff). Change only what the fix needs. If you don't have the current contents of a file you'd need to change, read it with read_files first — never call propose_pr with guessed content. Never claim a PR is open — propose_pr hands the change to the user to confirm and open.`;
      tools.push({
        name: 'propose_pr',
        description:
          'Propose a fix as a pull request for the user to confirm. Provide the complete new content for each changed file. Only use when the user wants a fix opened as a PR and you have the real file contents to change.',
        input_schema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short PR title' },
            body: { type: 'string', description: 'What changed and why' },
            changes: {
              type: 'array',
              description: 'Each changed file with its complete new content',
              items: {
                type: 'object',
                properties: {
                  path: { type: 'string' },
                  content: { type: 'string', description: 'Complete new file content' }
                },
                required: ['path', 'content'],
                additionalProperties: false
              }
            }
          },
          required: ['title', 'body', 'changes'],
          additionalProperties: false
        }
      });
    }

    // Anti-repeat: hand back the last reply's opening so Byteling doesn't fall
    // into the same shape twice — the mechanical trick that keeps it from
    // sounding like a template.
    const lastAssistant = [...anthropicMessages].reverse().find((m) => m.role === 'assistant');
    if (lastAssistant && typeof lastAssistant.content === 'string' && lastAssistant.content) {
      system += `\n\nYour previous reply began: "${lastAssistant.content.slice(0, 100)}". Do not reuse that opening or the same sentence structure.`;
    }

    // Call Claude. Stream to the SDK and collect the final message so a large
    // max_tokens can't trip an HTTP timeout; we return the whole reply at once.
    // Deep-dive loop: when Byteling calls read_files, fetch the files server-side
    // and feed them back, then let it continue — capped at MAX_TOOL_ITERS rounds.
    const anthropic = new Anthropic({ apiKey });

    // Resolve the repo's default branch once, lazily on the first read.
    let repoRef: string | null = null;
    const resolveRef = async (): Promise<string | null> => {
      if (repoRef || !githubToken || !repoFullName) return repoRef;
      const [o, r] = repoFullName.split('/');
      const res = await fetch(`https://api.github.com/repos/${o}/${r}`, { headers: ghHeaders(githubToken) });
      if (res.ok) repoRef = (await res.json()).default_branch ?? 'main';
      return repoRef;
    };

    let final;
    for (let iter = 0; iter < MAX_TOOL_ITERS; iter++) {
      // On the last round, drop read_files so Byteling is forced to answer with
      // what it has rather than asking for more files it can't get.
      const offerTools = iter < MAX_TOOL_ITERS - 1 ? tools : tools.filter((t) => t.name !== 'read_files');
      try {
        final = await anthropic.messages.stream({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          thinking: { type: 'adaptive' },
          output_config: { effort },
          system,
          messages: anthropicMessages,
          ...(offerTools.length ? { tools: offerTools } : {})
        }).finalMessage();
      } catch (e) {
        const status = (e as { status?: number })?.status;
        if (status === 401 || status === 403) {
          // The stored key stopped working — flag it so the UI can prompt re-entry.
          await base44.asServiceRole.entities.ProviderKey.update(providerKey.id, { status: 'invalid' })
            .catch(() => {});
          return Response.json(
            { error: 'Your Anthropic key was rejected — please re-enter it', code: 'invalid_provider_key' },
            { status: 400 }
          );
        }
        throw e;
      }

      const readCalls = final.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'read_files'
      );
      if (!readCalls.length) break; // answered, or used a terminal tool (open_repo/propose_pr)

      // Preserve the full assistant turn (thinking + tool_use blocks are required
      // to continue), then answer each read_files call with the file contents.
      anthropicMessages.push({
        role: 'assistant',
        content: final.content as unknown as Anthropic.ContentBlockParam[]
      });
      const ref = await resolveRef();
      const [owner, repo] = repoFullName!.split('/');
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const call of readCalls) {
        const raw = (call.input as { paths?: unknown })?.paths;
        const paths = Array.isArray(raw)
          ? raw.filter((p): p is string => typeof p === 'string' && !!p).slice(0, MAX_READ_FILES)
          : [];
        let content: string;
        if (!paths.length) content = 'No valid file paths were provided.';
        else if (!ref || !githubToken) content = 'Could not access the repository to read files.';
        else content = formatReadResult(await readRepoFiles(githubToken, owner, repo, ref, paths));
        toolResults.push({ type: 'tool_result', tool_use_id: call.id, content });
      }
      anthropicMessages.push({ role: 'user', content: toolResults });
    }

    if (!final) {
      return Response.json({ error: 'The assistant could not respond' }, { status: 500 });
    }
    if (final.stop_reason === 'refusal') {
      return Response.json({ error: 'The assistant declined to respond to that.' }, { status: 422 });
    }

    const reply = final.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join('')
      .trim();

    // Harvest tool calls. open_repo is validated against the offered list so a
    // stray value can't point the frontend at an arbitrary repo. propose_pr is
    // returned for the user to confirm — this function never opens the PR.
    let openRepo: string | undefined;
    let prProposal: { title: string; body: string; changes: { path: string; content: string }[] } | undefined;
    for (const block of final.content) {
      if (block.type !== 'tool_use') continue;
      if (block.name === 'open_repo') {
        const target = (block.input as { repo_full_name?: unknown })?.repo_full_name;
        if (typeof target === 'string' && repos.some((r) => r.full_name === target)) {
          openRepo = target;
        }
      } else if (block.name === 'propose_pr') {
        const inp = block.input as { title?: unknown; body?: unknown; changes?: unknown };
        const changes = Array.isArray(inp.changes)
          ? inp.changes.filter(
              (c) => c && typeof (c as { path?: unknown }).path === 'string' && typeof (c as { content?: unknown }).content === 'string'
            )
          : [];
        if (typeof inp.title === 'string' && inp.title.trim() && changes.length) {
          prProposal = {
            title: inp.title.trim(),
            body: typeof inp.body === 'string' ? inp.body : '',
            changes: changes as { path: string; content: string }[]
          };
        }
      }
    }

    // Persist the turn if we have a session and actual text (a bare open_repo
    // turn with no prose isn't worth a stored message).
    let assistantSeq: number | undefined;
    if (sessionId && reply) {
      const existing = await base44.asServiceRole.entities.Message.filter(
        { session_id: sessionId },
        '-sequence_number',
        1
      );
      const maxSeq = existing?.[0]?.sequence_number ?? 0;
      const userSeq = maxSeq + 1;
      assistantSeq = maxSeq + 2;

      await base44.asServiceRole.entities.Message.create({
        owner_email: user.email,
        session_id: sessionId,
        role: 'user',
        content_type: 'text',
        text: message,
        sequence_number: userSeq
      });
      await base44.asServiceRole.entities.Message.create({
        owner_email: user.email,
        session_id: sessionId,
        role: 'assistant',
        content_type: 'text',
        text: reply,
        sequence_number: assistantSeq
      });
    }

    return Response.json({
      reply,
      open_repo: openRepo,
      pr_proposal: prProposal,
      session_id: sessionId ?? undefined,
      sequence_number: assistantSeq
    });
  } catch (error) {
    console.error('claude-chat failed:', error);
    return Response.json({ error: 'The assistant could not respond' }, { status: 500 });
  }
});
