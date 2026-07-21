import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

/**
 * Byteling — github-oauth-start
 *
 * Step 1 of the GitHub connect flow. Must be called with the user's credentials:
 *   base44.functions.invoke('github-oauth-start', {})
 *
 * Mints a single-use CSRF state bound to the caller and hands back the GitHub
 * authorize URL. The browser redirect that follows carries no Base44 session,
 * so that state record is the only thing tying the eventual `code` back to a
 * user — see github-oauth-callback.
 */

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Opaque 256-bit state value, hex encoded. */
function generateState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Only relative, single-slash-prefixed paths are allowed through to the
 * callback's final redirect. Anything protocol-ish or scheme-relative ("//evil")
 * would turn the callback into an open redirect.
 */
function sanitizeReturnPath(input: unknown): string {
  if (typeof input !== 'string' || !input.startsWith('/') || input.startsWith('//')) {
    return '/';
  }
  return input;
}

Deno.serve(async (req) => {
  try {
    const clientId = Deno.env.get('GITHUB_CLIENT_ID');
    const appBaseUrl = Deno.env.get('APP_BASE_URL');

    if (!clientId || !appBaseUrl) {
      // Deliberately vague to the client; the detail goes to logs.
      console.error('github-oauth-start: missing GITHUB_CLIENT_ID or APP_BASE_URL secret');
      return Response.json({ error: 'GitHub integration is not configured' }, { status: 500 });
    }

    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me();
    if (!user?.email) {
      return Response.json({ error: 'Authentication required' }, { status: 401 });
    }

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      // No body is fine — return_path is optional.
    }

    const state = generateState();
    const expiresAt = new Date(Date.now() + STATE_TTL_MS).toISOString();

    await base44.asServiceRole.entities.OAuthState.create({
      state,
      owner_email: user.email,
      owner_id: user.id,
      expires_at: expiresAt,
      consumed: false,
      return_path: sanitizeReturnPath(body.return_path)
    });

    // redirect_uri is built from our own secret, never from the request Host,
    // which a caller could spoof. It must match the OAuth App registration byte
    // for byte or GitHub rejects the exchange.
    const redirectUri = `${appBaseUrl.replace(/\/$/, '')}/functions/github-oauth-callback`;

    const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
    authorizeUrl.searchParams.set('client_id', clientId);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('scope', 'repo');
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('allow_signup', 'false');

    return Response.json({
      authorize_url: authorizeUrl.toString(),
      expires_at: expiresAt
    });
  } catch (error) {
    console.error('github-oauth-start failed:', error);
    return Response.json({ error: 'Could not start GitHub authorization' }, { status: 500 });
  }
});
