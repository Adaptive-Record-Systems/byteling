# Security & privacy — Byte-ling

How Byte-ling handles your code, your keys, and your GitHub account. Written to
be checkable against the source: every claim below points at where it lives.

## Architecture in one paragraph

Byte-ling is a Base44 app: a static frontend (`src/`) plus a set of serverless
backend functions (`base44/functions/`). The character/chat also ships as an
embeddable web component and a Chrome/Edge extension that reuse the same backend
cross-origin. There is no separate server we operate — the functions run on
Base44's runtime, and each user's data is isolated by Base44 row-level security.

## Your Anthropic key — bring-your-own-key

- You add **your own** Anthropic API key; Byte-ling never ships a shared app
  secret. Your usage is billed to your account, not ours.
- The key is validated before storage (a real call that must succeed) and stored
  on the `ProviderKey` entity, readable only under the **service role** — never
  returned to the browser. See `base44/functions/set-provider-key/entry.ts`.
- The chat function resolves your key server-side under the service role to make
  the Anthropic call; it is never exposed to the client or to any host page.

## Authentication & isolation

- Every backend function that touches data authenticates the caller with
  `base44.auth.me()` and returns **401** if there's no valid session
  (`set-provider-key`, `claude-chat`, `github-*`).
- Cross-user access is blocked: e.g. `claude-chat` verifies you own the chat
  session and returns **403 "Not your session"** otherwise
  (`base44/functions/claude-chat/entry.ts`).
- Tokens and keys are field-locked to the service role, so one user's row can't
  be read by another even through the entity API.

## GitHub access

- Connect is standard OAuth with a `state` check; the token is stored on
  `GitHubConnection` under the service role.
- **Writes are PR-only and never touch your base branch.** `github-pr` uses the
  Git Data API to create blobs → tree → commit → a **new branch**, then opens a
  pull request for you to review and merge. It never force-pushes or writes to
  the default branch — see the header of `base44/functions/github-pr/entry.ts`.
- Reading is scoped to repositories your connection can already see.

## Prompt injection (untrusted repo content)

Byte-ling reads your repositories, so repo content is untrusted input. The
mitigation is **human-in-the-loop, not model trust**: Byte-ling can *propose* a
change, but a pull request is only opened when **you click confirm**, and it only
ever lands on a new branch you then review. Byte-ling cannot merge, and cannot
write to your base branch.

## The web embed vs. the extension (token handling)

- **Web embed on your own site:** after a popup sign-in on Byte-ling's own
  origin, the access token is `postMessage`d back to the widget (origin-locked)
  and kept in that first-party site's `localStorage`.
- **Extension:** the content script runs in an isolated world whose
  `localStorage` belongs to *whatever page you summoned Byte-ling on* — an
  untrusted origin. So in the extension the **access token is kept in memory
  only and never persisted** (you re-sign-in after a reload). Only your
  non-secret first name is remembered, via the extension's own
  `chrome.storage.local` (not the host page's storage). See `IS_EXTENSION` in
  `src/embed/byteling-companion.jsx`.

## Extension permissions (minimal, click-to-summon)

`extension/manifest.json` requests only:

- `activeTab` + `scripting` — inject the companion into the current tab **when
  you click the toolbar icon** (not a background content script on every page,
  so it never auto-loads on your bank or email).
- `storage` — remember your first name across reloads (see above).
- a single `host_permissions` entry for the Byte-ling backend origin — so the
  companion's cross-origin API calls work regardless of the host page's CSP.

It ships no remote code: the bundle (`embed.js`) is packaged in the extension,
per MV3.

## On-screen "point at this" scanning

When you ask "where is X?", the companion scans the page for controls to point
at. It is **on-request only** (never in the background), sends only control
**labels, never their values**, and dead-zones password/secret fields.

## Known residual risks (honest list)

- The **web embed hands the access token to the first-party host page**. That's
  fine for your own site; a hardened multi-tenant version would mint a
  short-lived scoped token via a host proxy instead.
- The companion's Shadow DOM is open, so a malicious host page could read what
  you type into the panel — **don't paste secrets into the companion on a site
  you don't trust.**
- Prompt injection from repo content is *bounded* by the confirm-to-open-PR
  gate, not eliminated.

## Reporting

Found something? Open a GitHub issue (omit any secrets) or contact the
maintainer.
