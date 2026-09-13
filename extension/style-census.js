// style-census.js — copied verbatim from the canonical design bible:
//   C:/Github/ARS/claude-skills/skills/design-review/scripts/style-census.js
// The claude-skills copy stays canonical; re-sync this on changes there.
// Injected by the extension background worker (chrome.scripting) for /design review.
// Read-only, touches nothing; returns a JSON string as the executeScript result.

/**
 * style-census.js — evidence layer for the /design-review skill.
 * Run in the page (Browser pane JS tool, or paste into devtools console).
 * Returns a JSON summary of what the page ACTUALLY computes, so the design
 * review argues from numbers, not vibes. Read-only; touches nothing.
 */
(() => {
  const MAX = 4000; // element cap so huge pages stay fast
  const els = [...document.querySelectorAll('body *')].slice(0, MAX);
  const vis = els.filter(el => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  });

  const count = (map, key) => { if (key) map[key] = (map[key] || 0) + 1; };
  const top = (map, n = 12) =>
    Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n)
      .map(([k, v]) => ({ value: k, count: v }));

  // ---- fonts (first family actually rendered per element with text)
  const fonts = {};
  const textEls = vis.filter(el => [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()));
  textEls.forEach(el => count(fonts, getComputedStyle(el).fontFamily.split(',')[0].replace(/["']/g, '').trim()));

  // ---- colors
  const textColors = {}, bgColors = {};
  const parse = c => { const m = c && c.match(/rgba?\(([\d.\s,]+)\)/); return m ? m[1].split(',').map(Number) : null; };
  textEls.forEach(el => count(textColors, getComputedStyle(el).color));
  vis.forEach(el => {
    const bg = getComputedStyle(el).backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)') count(bgColors, bg);
  });

  // ---- gradients (and the violet/pink sigil)
  const gradients = [];
  vis.forEach(el => {
    const bi = getComputedStyle(el).backgroundImage;
    if (bi && bi.includes('gradient')) gradients.push(bi.slice(0, 140));
  });
  const violetPink = gradients.filter(g => {
    const stops = [...g.matchAll(/rgba?\(([\d.\s,]+)\)/g)].map(m => m[1].split(',').map(Number));
    return stops.some(([r, , b]) => b > 140 && r > 90 && b > r); // blue-violet leaning stop
  }).length;

  // ---- radii, shadows, glassmorphism, rotation
  const radii = {}, shadows = {};
  let backdrop = 0, rotated = 0;
  vis.forEach(el => {
    const s = getComputedStyle(el);
    if (s.borderRadius !== '0px') count(radii, s.borderRadius);
    if (s.boxShadow !== 'none') count(shadows, s.boxShadow.slice(0, 80));
    if (s.backdropFilter && s.backdropFilter !== 'none') backdrop++;
    const t = s.transform;
    if (t && t !== 'none') {
      const m = t.match(/matrix\(([-\d.]+), ([-\d.]+)/);
      if (m && Math.abs(Math.atan2(+m[2], +m[1])) > 0.01) rotated++;
    }
  });

  // ---- icons
  const svgs = document.querySelectorAll('svg').length;
  const lucide = document.querySelectorAll('svg.lucide, [class*="lucide-"]').length;

  // ---- type hierarchy depth
  const sizes = {};
  textEls.forEach(el => count(sizes, getComputedStyle(el).fontSize));

  // ---- spacing discipline: % of section-level paddings/margins off an 8px grid (4px tolerated)
  const sections = [...document.querySelectorAll('section, main > div, [class*="section"]')].slice(0, 120);
  let spacingVals = 0, offGrid = 0;
  sections.forEach(el => {
    const s = getComputedStyle(el);
    ['paddingTop', 'paddingBottom', 'marginTop', 'marginBottom'].forEach(p => {
      const v = Math.round(parseFloat(s[p]));
      if (v > 0) { spacingVals++; if (v % 4 !== 0) offGrid++; }
    });
  });

  // ---- section-height uniformity (hell-no: everything the same height)
  const hs = sections.map(el => el.getBoundingClientRect().height).filter(h => h > 100);
  const mean = hs.reduce((a, b) => a + b, 0) / (hs.length || 1);
  const cv = hs.length > 2 ? Math.sqrt(hs.reduce((a, h) => a + (h - mean) ** 2, 0) / hs.length) / mean : null;

  // ---- approximate contrast failures (WCAG AA 4.5:1, body-size text on solid bg)
  const lum = ([r, g, b]) => {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const bgOf = el => {
    for (let n = el; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && (c.length < 4 || c[3] > 0.9)) return c;
    }
    return [255, 255, 255];
  };
  let checked = 0, fails = 0;
  textEls.slice(0, 600).forEach(el => {
    const fg = parse(getComputedStyle(el).color);
    if (!fg) return;
    const bg = bgOf(el);
    const [l1, l2] = [lum(fg), lum(bg)].sort((a, b) => b - a);
    checked++;
    if ((l1 + 0.05) / (l2 + 0.05) < 4.5 && parseFloat(getComputedStyle(el).fontSize) < 24) fails++;
  });

  // ---- above-the-fold CTA count
  const fold = innerHeight;
  const ctas = [...document.querySelectorAll('a, button')].filter(el => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.top >= 0 && r.top < fold && r.width > 60 &&
      (el.tagName === 'BUTTON' || s.backgroundColor !== 'rgba(0, 0, 0, 0)' || parseFloat(s.borderWidth) > 0);
  }).length;

  return JSON.stringify({
    sampled: { elements: vis.length, textElements: textEls.length, capped: els.length === MAX },
    fonts: { distinct: Object.keys(fonts).length, families: top(fonts, 8) },
    colors: { textDistinct: Object.keys(textColors).length, bgDistinct: Object.keys(bgColors).length,
              topText: top(textColors, 8), topBg: top(bgColors, 8) },
    gradients: { total: gradients.length, violetPinkSuspects: violetPink, samples: gradients.slice(0, 5) },
    radii: { distinct: Object.keys(radii).length, top: top(radii, 6) },
    shadows: { distinct: Object.keys(shadows).length },
    glassmorphism: { backdropFilterEls: backdrop },
    rotation: { rotatedEls: rotated },
    icons: { svgTotal: svgs, lucide },
    typeScale: { distinctSizes: Object.keys(sizes).length, top: top(sizes, 10) },
    spacing: { valuesChecked: spacingVals, offGridPct: spacingVals ? Math.round(100 * offGrid / spacingVals) : null },
    sections: { measured: hs.length, heightVariation: cv === null ? null : +cv.toFixed(2),
                note: 'heightVariation < 0.25 with 4+ sections suggests uniform-rhythm hell-no' },
    contrast: { checked, aaFailures: fails },
    foldCTAs: ctas,
    headline: (document.querySelector('h1')?.innerText || '').slice(0, 160)
  }, null, 2);
})();
