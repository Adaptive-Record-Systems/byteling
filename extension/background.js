// Byte-ling extension — toolbar-summon.
//
// Clicking the toolbar icon injects the companion (the same self-contained
// embed.js the web embed uses) onto the current tab. It runs in the content-
// script isolated world, so its cross-origin calls to the Byte-ling backend
// use the extension's host permission and aren't blocked by the page's CSP.
// embed.js is idempotent (guards against a second define / mount), so clicking
// again on a page that already has it is a no-op.

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url) return;
  // Pages the browser won't let us inject into.
  if (/^(chrome|edge|brave|about|chrome-extension|view-source|https:\/\/chromewebstore\.google\.com):/.test(tab.url)) {
    return;
  }
  try {
    // Toggle: if the companion is already on the page, take it back down.
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const el = document.querySelector('[data-byteling-root], byteling-companion');
        if (el) { el.remove(); return 'removed'; }
        return 'absent';
      }
    });
    if (result === 'removed') return; // clicked again → dismissed

    // Not present → summon it.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['embed.js'] });
  } catch (e) {
    console.warn('Byte-ling: cannot run on this page —', e && e.message);
  }
});
