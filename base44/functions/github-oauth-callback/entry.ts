import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

/**
 * Byteling — github-oauth-callback
 *
 * Step 2 of the GitHub connect flow, and the registered OAuth redirect URI:
 *   https://<app>/functions/github-oauth-callback
 *
 * This is a plain browser GET. It carries no Base44 session and no SDK token,
 * so every operation here runs under the service role and the user is resolved
 * solely from the OAuthState record minted by github-oauth-start.
 *
 * The access token is written to GitHubConnection and never rendered, logged,
 * or placed in the redirect URL.
 */

const REQUIRED_SCOPE = 'repo';

/** Redirect the browser back into the app with a short status code. */
function redirectToApp(appBaseUrl: string, path: string, status: string): Response {
  const target = new URL(path, appBaseUrl);
  target.searchParams.set('github', status);
  return Response.redirect(target.toString(), 302);
}

Deno.serve(async (req) => {
  const appBaseUrl = Deno.env.get('APP_BASE_URL');
  const clientId = Deno.env.get('GITHUB_CLIENT_ID');
  const clientSecret = Deno.env.get('GITHUB_CLIENT_SECRET');

  if (!appBaseUrl || !clientId || !clientSecret) {
    console.error('github-oauth-callback: missing one of APP_BASE_URL / GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET');
    return new Response('GitHub integration is not configured', { status: 500 });
  }

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const oauthError = url.searchParams.get('error');

    // User clicked "Cancel" on GitHub's consent screen, or GitHub refused.
    if (oauthError) {
      console.warn('github-oauth-callback: GitHub returned error', oauthError);
      return redirectToApp(appBaseUrl, '/', 'denied');
    }

    if (!code || !state) {
      return redirectToApp(appBaseUrl, '/', 'invalid');
    }

    const base44 = createClientFromRequest(req);
    const svc = base44.asServiceRole;

    // --- Validate the state: must exist, be unconsumed, and be unexpired. ---
    const matches = await svc.entities.OAuthState.filter({ state });
    const stateRecord = matches?.[0];

    if (!stateRecord) {
      console.warn('github-oauth-callback: unknown state');
      return redirectToApp(appBaseUrl, '/', 'invalid');
    }

    if (stateRecord.consumed) {
      console.warn('github-oauth-callback: replayed state for', stateRecord.owner_email);
      return redirectToApp(appBaseUrl, '/', 'invalid');
    }

    if (new Date(stateRecord.expires_at).getTime() < Date.now()) {
      console.warn('github-oauth-callback: expired state for', stateRecord.owner_email);
      return redirectToApp(appBaseUrl, '/', 'expired');
    }

    // Burn the state *before* the exchange so two concurrent callbacks with the
    // same code cannot both proceed.
    await svc.entities.OAuthState.update(stateRecord.id, { consumed: true });

    const returnPath =
      typeof stateRecord.return_path === 'string' &&
      stateRecord.return_path.startsWith('/') &&
      !stateRecord.return_path.startsWith('//')
        ? stateRecord.return_path
        : '/';

    // --- Exchange the code for an access token. ---
    const redirectUri = `${appBaseUrl.replace(/\/$/, '')}/functions/github-oauth-callback`;

    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri
      })
    });

    if (!tokenRes.ok) {
      console.error('github-oauth-callback: token endpoint HTTP', tokenRes.status);
      return redirectToApp(appBaseUrl, returnPath, 'failed');
    }

    const tokenData = await tokenRes.json();

    // GitHub signals exchange failures with HTTP 200 and an `error` field.
    if (tokenData.error || !tokenData.access_token) {
      console.error('github-oauth-callback: token exchange rejected:', tokenData.error);
      return redirectToApp(appBaseUrl, returnPath, 'failed');
    }

    // Confirm we actually got `repo` and nothing wider. GitHub can return fewer
    // scopes than requested, and a broader grant means the OAuth App is
    // misconfigured — either way, don't store it.
    const grantedScopes = String(tokenData.scope || '')
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean);

    const scopeIsExactlyRepo =
      grantedScopes.length === 1 && grantedScopes[0] === REQUIRED_SCOPE;

    if (!scopeIsExactlyRepo) {
      console.error('github-oauth-callback: unexpected scopes granted:', grantedScopes.join(','));
      return redirectToApp(appBaseUrl, returnPath, 'bad_scope');
    }

    // --- Resolve the GitHub identity behind the token. ---
    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'byteling'
      }
    });

    if (!userRes.ok) {
      console.error('github-oauth-callback: /user lookup failed with HTTP', userRes.status);
      return redirectToApp(appBaseUrl, returnPath, 'failed');
    }

    const ghUser = await userRes.json();

    // --- Upsert the connection for this (Base44 user, GitHub account) pair. ---
    const connectionFields = {
      owner_email: stateRecord.owner_email,
      owner_id: stateRecord.owner_id,
      github_username: ghUser.login,
      github_user_id: ghUser.id,
      scope: tokenData.scope,
      access_token: tokenData.access_token,
      token_type: tokenData.token_type || 'bearer',
      status: 'active'
    };

    const existing = await svc.entities.GitHubConnection.filter({
      owner_email: stateRecord.owner_email,
      github_user_id: ghUser.id
    });

    if (existing?.[0]) {
      // Re-authorizing replaces the old token rather than accumulating rows.
      await svc.entities.GitHubConnection.update(existing[0].id, connectionFields);
    } else {
      await svc.entities.GitHubConnection.create(connectionFields);
    }

    return redirectToApp(appBaseUrl, returnPath, 'connected');
  } catch (error) {
    // Never surface the raw error to the browser — it may quote request details.
    console.error('github-oauth-callback failed:', error);
    return redirectToApp(appBaseUrl, '/', 'failed');
  }
});
