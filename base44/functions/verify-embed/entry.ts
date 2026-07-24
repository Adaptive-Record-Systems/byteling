/**
 * Byteling — verify-embed
 *
 * Public (no auth). Powers the "Check my site" button on /install.html:
 * given a URL the owner just pasted the one-liner into, fetch that page and
 * report whether Byte-ling's embed is present. Kills the "did it even work?"
 * dread that stops non-technical people from finishing the install.
 *
 *   POST { url: "https://mysite.com" }
 *     → { ok: true, found: boolean, finalUrl, status }
 *     → { ok: false, error }
 *
 * SSRF posture: this is a public fetcher, so it is deliberately conservative.
 *   - http/https only, default ports only
 *   - private / loopback / link-local / metadata hosts rejected, and
 *     re-checked on every redirect hop (manual redirects, capped at 4)
 *   - 8s timeout, body read capped at 512 KB
 *   - it never returns the fetched body — only a boolean and the HTTP status —
 *     so even a bypass leaks almost nothing.
 */

const MARKERS = [
  '/embed.js',            // the one-liner script src (any host — covers proxied/cached copies)
  '<byteling-companion',  // the explicit web-component tag
];
const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 4;
const TIMEOUT_MS = 8000;

/** Reject hosts that shouldn't be reachable through a public proxy. */
function hostIsBlocked(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) {
    return true;
  }
  // IPv6 loopback / unique-local / link-local
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;

  // IPv4 literals in private / loopback / link-local (incl. cloud metadata 169.254.169.254)
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a >= 224) return true; // multicast / reserved
  }
  return false;
}

function normalizeUrl(raw: string): URL | null {
  let s = raw.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s; // people paste "mysite.com"
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.port && !['', '80', '443'].includes(u.port)) return null; // default ports only
  if (hostIsBlocked(u.hostname)) return null;
  return u;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ ok: false, error: 'POST a JSON body { url }' }, { status: 405 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: 'Expected a JSON body' }, { status: 400 });
  }

  let target = normalizeUrl(typeof body.url === 'string' ? body.url : '');
  if (!target) {
    return Response.json(
      { ok: false, error: "That doesn't look like a public website address." },
      { status: 400 }
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    let res: Response | null = null;
    // Follow redirects by hand so we can re-validate the host on every hop.
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      res = await fetch(target.href, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'byteling-verify/1.0 (+https://byteling-baas-417f0fd8.base44.app)',
          Accept: 'text/html,application/xhtml+xml',
        },
      });

      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        if (hop === MAX_REDIRECTS) {
          return Response.json({ ok: false, error: 'That site redirected too many times.' }, { status: 502 });
        }
        const next = normalizeUrl(new URL(res.headers.get('location')!, target.href).href);
        if (!next) {
          return Response.json({ ok: false, error: 'That site redirected somewhere we can’t reach.' }, { status: 502 });
        }
        await res.body?.cancel();
        target = next;
        continue;
      }
      break;
    }

    if (!res) {
      return Response.json({ ok: false, error: 'Could not reach that site.' }, { status: 502 });
    }

    if (!res.ok) {
      await res.body?.cancel();
      return Response.json({
        ok: true,
        found: false,
        finalUrl: target.href,
        status: res.status,
        reason: `The site responded with ${res.status}.`,
      });
    }

    // Read the body incrementally, stopping at MAX_BYTES. We only need enough to
    // spot the marker; large pages don't get fully buffered.
    let html = '';
    let bytes = 0;
    const reader = res.body?.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: false });
    if (reader) {
      while (bytes < MAX_BYTES) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        html += decoder.decode(value, { stream: true });
      }
      await reader.cancel();
    }

    const found = MARKERS.some((mk) => html.includes(mk));
    return Response.json({ ok: true, found, finalUrl: target.href, status: res.status });
  } catch (e) {
    const aborted = (e as { name?: string })?.name === 'AbortError';
    return Response.json(
      { ok: false, error: aborted ? 'That site took too long to respond.' : 'Could not reach that site.' },
      { status: 502 }
    );
  } finally {
    clearTimeout(timer);
  }
});
