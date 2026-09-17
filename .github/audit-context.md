# Audit context — Byteling

Read by the weekly Nexus codebase audit BEFORE it judges this repo. Decisions
listed here are deliberate: never report them as gaps or concerns. One dated line
per decision; mark superseded entries rather than deleting recent ones.

## Deliberate decisions
- 2026-07: BYOK — each user supplies their own Anthropic key (ProviderKey, service-role field-locked); there is no shared app secret. "No API key handling" findings are by design.
- 2026-07: Writes are PR-only — Byte proposes changes and opens a GitHub PR on a new branch; it never edits a branch directly. github-pr never touches the base branch.
- 2026-07: Delivery target is the embeddable web component (`<byteling-companion>` / embed.js) + the Chrome/Edge extension. The main Base44 app is a demo/onboarding surface, not the primary product.
- 2026-07: Extension token is memory-only (host page is untrusted); only the non-secret first name persists (chrome.storage). Not a "missing persistence" bug.
- 2026-09-13: Chat + reviews run on claude-opus-4-8 via the user's key; chat effort defaults to 'medium' (speed over max depth for companion chat) — users can set higher on their key.
- 2026-09-13: The embed does NOT mount on mobile viewports (max-width:768px) — the docked flame stole host-app touch targets. Opt back in with mobile="show". Mobile layout is deferred, not forgotten.
- 2026-09-13: Designling — a design-review mode (designReview backend function + extension tab-capture/style-census + companion overlay). Reviews are EPHEMERAL: screenshots/census never persisted to entities.
- 2026-09-14: Designling's rulebook is NOT a hand snapshot — `scripts/sync-design-bible.mjs` regenerates the DESIGN_BIBLE block in designReview/entry.ts from the canonical claude-skills docs (the function can't read that repo at runtime). Re-run it when the bible/skills evolve, then redeploy. The stale-snapshot risk is handled by re-syncing, not by the auditor.
- ⚠️ Known/accepted: the Base44 backend was Builder-created, not `npx base44 create`d — a competition-qualification question raised with organizers, not a defect to "fix" blindly.

## Environment notes
- Developers work from local clones with the full npm toolchain; the Base44 web editor having no shell is irrelevant to how this repo is developed.
- The embed bundle (dist/embed.js) is built and the extension copy (extension/embed.js) is committed — regenerate with `npm run build:extension` after embed/extension source changes.
- Deploy is `npm run deploy:live` (vite build + `base44 deploy` from the repo); merging to main alone does not update the live site. embed.js is served with a 1-hour cache — hard-refresh after deploy.
- Planning docs inside the repo (e.g. under src/docs/) may predate current strategy — trust git history and this ledger over them.
- Base44 platform limits are not gaps: no push notifications exist platform-wide; auth pages are platform-owned.
