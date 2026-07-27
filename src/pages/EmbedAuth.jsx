import React, { useEffect, useState } from 'react';
import { appParams } from '@/lib/app-params';
import { base44 } from '@/api/base44Client';
import { firstNameFrom } from '@/lib/name';

/**
 * Popup landing page for the <byteling-companion> embed's sign-in.
 *
 * The embed (running on a third-party origin) opens this page in a popup:
 *   {BYTELING_BASE}/embed-auth?opener=<encodeURIComponent(host origin)>
 *
 * On this (Byteling) origin we have — or can obtain via Base44 login — a valid
 * access token. Once we do, we postMessage it back to the opener's exact origin
 * and close. The embed then calls the backend cross-origin with that token.
 *
 * Note: this hands the user's Base44 access token to the host page. That's the
 * inherent tradeoff of a client-only embed; a hardened version would mint a
 * short-lived, scoped session token via the host's own backend (see roadmap).
 */
export default function EmbedAuth() {
  const [status, setStatus] = useState('Signing you in…');

  useEffect(() => {
    (async () => {
      const opener = new URLSearchParams(window.location.search).get('opener');
      const token = appParams.token;

      // No token yet → go through Base44's hosted login and come back here.
      if (!token) {
        base44.auth.redirectToLogin(window.location.href);
        return;
      }

      // Validate it before handing it over; a stale token → re-login.
      let me = null;
      try {
        me = await base44.auth.me();
      } catch {
        base44.auth.redirectToLogin(window.location.href);
        return;
      }

      // First name for the greeting — but never a username/email handle (e.g.
      // "cfair1911"); firstNameFrom returns '' for those, so the embed passes no
      // name and Byte doesn't greet by a handle (the user can still state their
      // real name in chat). Not secret, but only sent to the opener's exact origin.
      const name = firstNameFrom(me?.full_name || me?.name || '');

      if (window.opener && opener) {
        window.opener.postMessage({ type: 'byteling-auth', token, name }, opener);
        setStatus('Signed in — you can close this window.');
        setTimeout(() => window.close(), 400);
      } else {
        setStatus('Signed in. Return to the app to continue.');
      }
    })();
  }, []);

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'ui-sans-serif, system-ui, sans-serif', color: '#555', padding: 24, textAlign: 'center'
    }}>
      {status}
    </div>
  );
}
