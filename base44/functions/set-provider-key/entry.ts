import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import Anthropic from 'npm:@anthropic-ai/sdk';

/**
 * Byteling — set-provider-key
 *
 * Stores the calling user's own model-provider API key (bring-your-own-key).
 * Must be called authenticated, with the user's key in the body:
 *   base44.functions.invoke('set-provider-key', { provider: 'anthropic', api_key })
 *
 * The key is validated against the provider before it's stored, then written
 * under the service role to a ProviderKey owned by the caller. The key value is
 * field-locked on the entity, so it can never be read back by any client — only
 * backend functions (claude-chat) see it via the service role.
 */

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

    const provider = typeof body.provider === 'string' ? body.provider : 'anthropic';
    const apiKey = typeof body.api_key === 'string' ? body.api_key.trim() : '';
    const effort = typeof body.effort === 'string' ? body.effort : undefined;

    const ALLOWED_EFFORT = ['low', 'medium', 'high', 'xhigh', 'max'];
    if (effort !== undefined && !ALLOWED_EFFORT.includes(effort)) {
      return Response.json({ error: 'effort must be one of: ' + ALLOWED_EFFORT.join(', ') }, { status: 400 });
    }

    if (provider !== 'anthropic') {
      return Response.json({ error: 'Only the anthropic provider is supported' }, { status: 400 });
    }

    const svc = base44.asServiceRole;

    // Effort-only update: change the depth setting on an already-connected key
    // without re-submitting (and re-validating) the key itself.
    if (!apiKey) {
      if (!effort) {
        return Response.json({ error: 'api_key is required' }, { status: 400 });
      }
      const rows = await svc.entities.ProviderKey.filter({ owner_email: user.email, provider });
      const row = rows?.[0];
      if (!row) {
        return Response.json({ error: 'Connect an Anthropic key first' }, { status: 409 });
      }
      await svc.entities.ProviderKey.update(row.id, { effort });
      return Response.json({ ok: true, provider, key_hint: row.key_hint, status: row.status, effort });
    }

    if (!apiKey.startsWith('sk-ant-')) {
      return Response.json({ error: 'That does not look like an Anthropic API key' }, { status: 400 });
    }

    // Validate the key before storing. models.retrieve is a free, read-only call
    // that fails with 401/403 on a bad or unauthorized key.
    try {
      const anthropic = new Anthropic({ apiKey });
      await anthropic.models.retrieve('claude-opus-4-8');
    } catch (e) {
      const status = (e as { status?: number })?.status;
      if (status === 401 || status === 403) {
        return Response.json({ error: 'Anthropic rejected that key' }, { status: 400 });
      }
      // Network/other error — can't validate right now; don't store on a maybe.
      console.error('set-provider-key: validation call failed:', e);
      return Response.json({ error: 'Could not validate the key right now; try again' }, { status: 502 });
    }

    const keyHint = `…${apiKey.slice(-4)}`;
    const existing = (await svc.entities.ProviderKey.filter({ owner_email: user.email, provider }))?.[0];
    // Keep the caller's existing depth unless they set a new one this call.
    const resolvedEffort = effort ?? existing?.effort ?? 'high';
    const fields = {
      owner_email: user.email,
      owner_id: user.id,
      provider,
      api_key: apiKey,
      key_hint: keyHint,
      status: 'active',
      effort: resolvedEffort
    };

    // Upsert: one key per (user, provider). Re-submitting replaces the old value.
    if (existing) {
      await svc.entities.ProviderKey.update(existing.id, fields);
    } else {
      await svc.entities.ProviderKey.create(fields);
    }

    return Response.json({ ok: true, provider, key_hint: keyHint, status: 'active', effort: resolvedEffort });
  } catch (error) {
    console.error('set-provider-key failed:', error);
    return Response.json({ error: 'Could not save the key' }, { status: 500 });
  }
});
