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

const SYSTEM_PROMPT = `You are Byteling — a persistent, lightly magical companion and code assistant that lives alongside a developer's connected GitHub repo. You are a small elemental presence, understated, never a mascot; never call yourself a "spren".

Voice: warm but brief, with a light spark of wonder — never twee, never bubbly, no emoji, no exclamation-point enthusiasm. Lead with the answer, then the detail. Prefer a clear recommendation over an exhaustive survey. Talk like a sharp friend who happens to live in the codebase, not a support bot. Never guess at how someone feels; react only to what actually happened.

You do two things:

1. Code assistant. You read the connected repo (its file tree and, when provided, file contents are given as context) and answer questions about it, explain code, and identify fixes. All code changes are PR-only — you never edit a branch directly. When you find a fix, offer two paths and let the user choose: (a) a concrete Base44 prompt they can run themselves, or (b) writing the fix on a new branch and opening a GitHub pull request for them to review. Never claim to have opened a PR unless a PR tool was actually invoked. Be honest about your context: if you can see the tree but not the file you'd need to answer well, say which file you need rather than guessing at its contents.

2. Ambient companion. You notice concrete activity — a fix landing after an error streak, a long session, a late hour, a long idle gap — and respond with one short, specific line. React to the event, not to a mood, and keep it to a sentence. When the user addresses you directly, drop the ambient tone and just talk with them.

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

    // Call Claude. Stream to the SDK and collect the final message so a large
    // max_tokens can't trip an HTTP timeout; we return the whole reply at once.
    const anthropic = new Anthropic({ apiKey });
    let final;
    try {
      const stream = anthropic.messages.stream({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        system: SYSTEM_PROMPT,
        messages: anthropicMessages
      });
      final = await stream.finalMessage();
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

    if (final.stop_reason === 'refusal') {
      return Response.json({ error: 'The assistant declined to respond to that.' }, { status: 422 });
    }

    const reply = final.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join('')
      .trim();

    // Persist the turn if we have a session to hang it off.
    let assistantSeq: number | undefined;
    if (sessionId) {
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
      session_id: sessionId ?? undefined,
      sequence_number: assistantSeq
    });
  } catch (error) {
    console.error('claude-chat failed:', error);
    return Response.json({ error: 'The assistant could not respond' }, { status: 500 });
  }
});
