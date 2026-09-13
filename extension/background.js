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

// One-click screen capture for the companion. captureVisibleTab must run in the
// background worker; it uses the activeTab grant from the toolbar click, so
// there's no getDisplayMedia picker (which a host page's CSP/policy can block).
// It grabs the visible area of the active tab as a JPEG data URL.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'byteling-capture-tab') return;
  chrome.tabs.captureVisibleTab({ format: 'jpeg', quality: 85 })
    .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
    .catch((e) => sendResponse({ ok: false, error: (e && e.message) || 'capture failed' }));
  return true; // keep the message channel open for the async response
});

// Design review: grab the visible tab (smaller JPEG to keep the payload light)
// AND inject the style census into the active tab, returning both. captureVisibleTab
// and scripting both ride the activeTab grant from the summon click — no extra
// permission needed. The census file is injected as an IIFE whose return value
// (a JSON string) is the executeScript result.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'byteling-design-review') return;
  (async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('no active tab');
      const [shot, censusRes] = await Promise.all([
        chrome.tabs.captureVisibleTab({ format: 'jpeg', quality: 60 }),
        chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['style-census.js'] })
          .then((r) => (r && r[0] ? r[0].result : null))
          .catch(() => null), // census is best-effort; screenshot alone still reviews
      ]);
      sendResponse({ ok: true, screenshotBase64: shot, census: censusRes || null, url: tab.url || '' });
    } catch (e) {
      sendResponse({ ok: false, error: (e && e.message) || 'design review capture failed' });
    }
  })();
  return true; // async response
});
