# Byte-ling — Chrome extension

Summon Byte-ling on any page by clicking the toolbar icon. It's the same
companion as the web embed (`<byteling-companion>`), packaged so it rides
along on sites you visit instead of needing a `<script>` tag on the page.

## Load it (unpacked, for development)

1. Build the bundle so `extension/embed.js` is current:
   ```bash
   npm run build:extension
   ```
   (A copy is already checked in, so you can skip this the first time.)
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked** and select this `extension/` folder.
5. Pin the Byte-ling icon, then **click it on any normal web page** — the
   lantern docks in the corner. Sign in and add your Anthropic key (once),
   same as the web embed.

## Notes

- **Toolbar-summon**, not always-on: it only appears on tabs where you click
  the icon. Clicking again on the same page is a no-op (it's already there).
- Some pages can't be injected (the Chrome Web Store, `chrome://` pages, PDFs);
  the icon simply does nothing there.
- Auth + chat work exactly like the embed — the companion talks to the
  Byte-ling backend cross-origin; your Anthropic key stays yours.

## What's here

| File | Purpose |
|---|---|
| `manifest.json` | MV3 manifest (action + background worker + host permission) |
| `background.js` | On toolbar click, injects `embed.js` into the active tab |
| `embed.js` | The self-contained companion bundle (copied from `dist/embed.js`) |
| `icons/` | Toolbar/store icons (the lantern) |

## Keeping `embed.js` in sync

`extension/embed.js` is a copy of the built web embed. After changing the
companion, run `npm run build:extension` and reload the extension.

## Publishing (later)

For the Chrome Web Store, zip this folder and upload it in the Developer
Dashboard. Bump `version` in `manifest.json` on each release.
