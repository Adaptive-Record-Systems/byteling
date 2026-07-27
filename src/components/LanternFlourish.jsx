import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

/**
 * LanternFlourish — the premium, video-driven spren flourish.
 *
 * The flame slips its lantern and comes back:
 *   OUT  flame-to-leaves.mp4 — the flame unravels into leaves that stream up
 *   DARK the lantern sits fully dark for a beat (it genuinely "left")
 *   IN   ribbon-to-flame.mp4 — a ribbon descends and settles into the flame
 * then the idle loop resumes. Rare and randomised (never a loop), skipped under
 * prefers-reduced-motion and in a backgrounded tab.
 *
 * The clips are flame-on-black, so the same luminance→alpha key the flying flame
 * uses (#btl-spren-alpha) turns the black into REAL transparency — composites
 * over any page colour. While a flourish plays its colour FREELY SHIFTS through
 * the spectrum (an animated hue-rotate on the wrapper) — the moment is a little
 * magical, distinct from the idle flame's steady per-repo tint.
 *
 * While active, `onActiveChange(true)` lets the parent hide the idle flame so the
 * lantern goes dark; `onActiveChange(false)` fires as the return clip lands on
 * the resting flame, handing back to the idle loop.
 *
 * Props:
 *   anchorRef     the lantern wrapper (the flourish anchors to its flame seat)
 *   enabled       self-schedule rare flourishes (default true)
 *   minMs/maxMs   randomised gap between flourishes (default 15–40 min)
 *   outClip/inClip  the two clip URLs
 *   onActiveChange(bool)  called when the flourish takes over / hands back
 *
 * Imperative: ref.play() fires one now (used by a manual trigger for demos).
 * Live geometry calibration without a rebuild:
 *   window.__flourishTune = { fx, fy, hm, seatX, seatY }
 */

// ── tuning (calibrated in /flourish-demo.html or via window.__flourishTune) ──
const FLAME_FX = 0.5;       // the flame's horizontal position within the clip frame
const FLAME_FY = 0.80;      // flame sits ~80% down the clip (leaves rise into the space above) — read off the source clip
const HEIGHT_MUL = 2.5;     // overlay height as a multiple of the lantern's width — calibrated
const SEAT_X = 0.505;       // the lantern flame seat, as a fraction of the wrapper
const SEAT_Y = 0.62;        // anchor the flame a touch higher on the lantern (was 0.70)
const DARK_MS = 650;        // lantern fully dark between OUT and IN
const CLIP_MAX_MS = 5600;   // safety cap per clip if 'ended' never fires
const HUE_CYCLE_MS = 5000;  // one full colour rotation while a flourish plays

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// "Ask Byte to do a flourish" — a chat message that's really a request to
// perform, so the client fires the flourish directly (deterministic, instant,
// no round-trip) rather than leaving it to the model.
const FLOURISH_RE = /\b(do (a|your|the) (little )?(flourish|trick|dance|twirl|spin)|(a )?flourish\b|dance for me|dance for us|show me (some )?(magic|a trick|your magic|something)|show off|twirl|spin for me|come alive|do your thing|do something (magical|pretty|cool))\b/i;
export function isFlourishRequest(text) {
  return FLOURISH_RE.test((text || '').trim());
}
// A short, in-character line to say while performing (understated — no
// exclamation, no mascot energy, matching Byte's voice).
const FLOURISH_LINES = ['Watch this.', 'For you —', 'A little light.', 'Since you asked.', 'Like this?', 'Mm — here.'];
export function flourishLine() {
  return FLOURISH_LINES[Math.floor(Math.random() * FLOURISH_LINES.length)];
}

function onceEnded(video, maxMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(t); video.removeEventListener('ended', finish); resolve(); };
    video.addEventListener('ended', finish, { once: true });
    const t = setTimeout(finish, maxMs);
  });
}

export const LanternFlourish = forwardRef(function LanternFlourish(
  { anchorRef, enabled = true, minMs = 15 * 60 * 1000, maxMs = 40 * 60 * 1000,
    outClip, inClip, onActiveChange },
  ref
) {
  const outWrapRef = useRef(null);
  const inWrapRef = useRef(null);
  const outRef = useRef(null);
  const inRef = useRef(null);
  const busyRef = useRef(false);
  const timerRef = useRef(null);

  // Anchor a wrapper so its clip's flame lands on the lantern's flame seat. Live
  // overrides (window.__flourishTune) let you calibrate against the real lantern.
  const place = (wrapEl) => {
    const el = anchorRef?.current;
    if (!el || !wrapEl) return false;
    const r = el.getBoundingClientRect();
    if (!r.width) return false;
    const T = (typeof window !== 'undefined' && window.__flourishTune) || {};
    const fx = T.fx ?? FLAME_FX;
    const fy = T.fy ?? FLAME_FY;
    const hm = T.hm ?? HEIGHT_MUL;
    const seatX = T.seatX ?? SEAT_X;
    const seatY = T.seatY ?? SEAT_Y;
    const targetX = r.left + r.width * seatX;
    const targetY = r.top + r.height * seatY;
    const h = r.width * hm;
    const w = h * (16 / 9);
    wrapEl.style.width = `${w}px`;
    wrapEl.style.height = `${h}px`;
    wrapEl.style.left = `${targetX - fx * w}px`;
    wrapEl.style.top = `${targetY - fy * h}px`;
    return true;
  };

  const play = async () => {
    if (busyRef.current || reducedMotion() || !outClip || !inClip) return;
    const out = outRef.current, inv = inRef.current;
    const outWrap = outWrapRef.current, inWrap = inWrapRef.current;
    if (!out || !inv || !outWrap || !inWrap) return;
    busyRef.current = true;
    outWrap.classList.add('btl-spren-live');
    inWrap.classList.add('btl-spren-live');
    onActiveChange?.(true); // hide the idle flame — the lantern is about to empty
    try {
      // OUT — flame unravels into leaves, streaming up and away.
      if (place(outWrap)) {
        try { out.currentTime = 0; } catch { /* not ready */ }
        outWrap.style.opacity = '1';
        await out.play().catch(() => {});
        await onceEnded(out, CLIP_MAX_MS);
      }
      outWrap.style.opacity = '0';
      out.pause();

      // DARK — the lantern is empty for a beat; "it left."
      await wait(DARK_MS);

      // IN — a ribbon descends and settles back into the flame.
      if (place(inWrap)) {
        try { inv.currentTime = 0; } catch { /* not ready */ }
        inWrap.style.opacity = '1';
        await inv.play().catch(() => {});
        await onceEnded(inv, CLIP_MAX_MS);
      }
      // Hand back: relight the idle flame, then fade the clip's last frame out
      // over it so the swap is invisible.
      onActiveChange?.(false);
      await wait(200);
      inWrap.style.opacity = '0';
      inv.pause();
    } finally {
      outWrap.classList.remove('btl-spren-live');
      inWrap.classList.remove('btl-spren-live');
      busyRef.current = false;
    }
  };

  useImperativeHandle(ref, () => ({ play }), []);

  // Rare self-scheduling — surprise, not wallpaper.
  useEffect(() => {
    if (!enabled) return undefined;
    let stopped = false;
    const arm = () => {
      const gap = minMs + Math.random() * (maxMs - minMs);
      timerRef.current = setTimeout(async () => {
        if (stopped) return;
        if (!document.hidden && !reducedMotion()) {
          try { await play(); } catch { /* ignore */ }
        }
        if (!stopped) arm();
      }, gap);
    };
    arm();
    return () => { stopped = true; clearTimeout(timerRef.current); };
  }, [enabled, minMs, maxMs]);

  const wrapStyle = {
    position: 'fixed', left: 0, top: 0, zIndex: 40, pointerEvents: 'none',
    opacity: 0, transition: 'opacity .2s ease', willChange: 'opacity',
  };

  return (
    <>
      {/* luminance→alpha key: black background → true transparency */}
      <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute' }}>
        <filter id="btl-spren-alpha" colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix"
            values="1 0 0 0 0
                    0 1 0 0 0
                    0 0 1 0 0
                    0.4 0.6 0.5 0 0" />
          <feComponentTransfer>
            <feFuncA type="gamma" amplitude="1.15" exponent="1.8" offset="0" />
          </feComponentTransfer>
        </filter>
      </svg>
      {outClip && (
        <div ref={outWrapRef} className="btl-spren-wrap" aria-hidden="true" style={wrapStyle}>
          <video ref={outRef} className="btl-spren-clip" src={outClip} muted playsInline preload="auto" />
        </div>
      )}
      {inClip && (
        <div ref={inWrapRef} className="btl-spren-wrap" aria-hidden="true" style={wrapStyle}>
          <video ref={inRef} className="btl-spren-clip" src={inClip} muted playsInline preload="auto" />
        </div>
      )}
      <style>{`
        /* the flame-on-black clip → real transparency; hue-rotate lives on the
           wrapper so the colour can animate independently of the alpha key */
        .btl-spren-clip {
          width: 100%; height: 100%; object-fit: fill; display: block;
          filter: brightness(1.05) url(#btl-spren-alpha);
        }
        /* Feather the frame edges to transparency so the rectangular video frame
           never shows a hard box. The mask lives on the WRAPPER (a div) — masks on
           a <video> are unreliable, which left the box hard. The bottom fades in
           early (below the flame) to crop the clip's floor reflection; the top
           fades so rising leaves soften out as they leave the frame. */
        .btl-spren-wrap {
          -webkit-mask:
            linear-gradient(to right,  transparent 0, #000 10%, #000 90%, transparent 100%),
            linear-gradient(to bottom, transparent 0, #000 22%, #000 84%, transparent 95%);
          -webkit-mask-composite: source-in;
          mask:
            linear-gradient(to right,  transparent 0, #000 10%, #000 90%, transparent 100%),
            linear-gradient(to bottom, transparent 0, #000 22%, #000 84%, transparent 95%);
          mask-composite: intersect;
        }
        /* colour freely shifts through the spectrum while the flourish plays */
        .btl-spren-wrap.btl-spren-live { animation: btl-spren-hue ${HUE_CYCLE_MS}ms linear infinite; }
        @keyframes btl-spren-hue {
          from { filter: hue-rotate(0deg); }
          to   { filter: hue-rotate(360deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          .btl-spren-wrap.btl-spren-live { animation: none; }
        }
      `}</style>
    </>
  );
});
