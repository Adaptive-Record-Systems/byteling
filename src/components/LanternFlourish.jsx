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
 * over any page colour. The clips are amber (~32°); `hue` rotates off that so the
 * flourish matches whatever colour the lantern flame currently is.
 *
 * While active, `onActiveChange(true)` lets the parent hide the idle flame so the
 * lantern goes dark; `onActiveChange(false)` fires as the return clip lands on
 * the resting flame, handing back to the idle loop.
 *
 * Props:
 *   anchorRef     the lantern wrapper (the flourish anchors to its flame seat)
 *   hue           flame tint (per-repo); rotates off the clip's amber base
 *   enabled       self-schedule rare flourishes (default true)
 *   minMs/maxMs   randomised gap between flourishes (default 15–40 min)
 *   outClip/inClip  the two clip URLs
 *   onActiveChange(bool)  called when the flourish takes over / hands back
 */

// ── tuning (calibrated in /flourish-demo.html) ──────────────────────────────
const CLIP_BASE_HUE = 32;   // the clips' amber hue; tint rotates off this
const FLAME_FX = 0.5;       // the flame's horizontal position within the clip frame
const FLAME_FY = 0.6;       // …and vertical (fraction from the top)
const HEIGHT_MUL = 3.4;     // overlay height as a multiple of the lantern's width
const DARK_MS = 650;        // lantern fully dark between OUT and IN
const CLIP_MAX_MS = 5600;   // safety cap per clip if 'ended' never fires
const SEAT_X = 0.505;       // the lantern flame seat, as a fraction of the wrapper
const SEAT_Y = 0.70;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function onceEnded(video, maxMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(t); video.removeEventListener('ended', finish); resolve(); };
    video.addEventListener('ended', finish, { once: true });
    const t = setTimeout(finish, maxMs);
  });
}

export const LanternFlourish = forwardRef(function LanternFlourish(
  { anchorRef, hue = 200, enabled = true, minMs = 15 * 60 * 1000, maxMs = 40 * 60 * 1000,
    outClip, inClip, onActiveChange },
  ref
) {
  const outRef = useRef(null);
  const inRef = useRef(null);
  const busyRef = useRef(false);
  const timerRef = useRef(null);
  const hueRef = useRef(hue);
  hueRef.current = hue;

  // Anchor a clip so its flame lands on the lantern's flame seat.
  const place = (videoEl) => {
    const el = anchorRef?.current;
    if (!el || !videoEl) return false;
    const r = el.getBoundingClientRect();
    if (!r.width) return false;
    const targetX = r.left + r.width * SEAT_X;
    const targetY = r.top + r.height * SEAT_Y;
    const h = r.width * HEIGHT_MUL;
    const w = h * (16 / 9);
    videoEl.style.width = `${w}px`;
    videoEl.style.height = `${h}px`;
    videoEl.style.left = `${targetX - FLAME_FX * w}px`;
    videoEl.style.top = `${targetY - FLAME_FY * h}px`;
    videoEl.style.filter =
      `hue-rotate(${hueRef.current - CLIP_BASE_HUE}deg) brightness(1.05) url(#btl-spren-alpha)`;
    return true;
  };

  const play = async () => {
    if (busyRef.current || reducedMotion() || !outClip || !inClip) return;
    const out = outRef.current, inv = inRef.current;
    if (!out || !inv) return;
    busyRef.current = true;
    onActiveChange?.(true); // hide the idle flame — the lantern is about to empty
    try {
      // OUT — flame unravels into leaves, streaming up and away.
      if (place(out)) {
        try { out.currentTime = 0; } catch { /* not ready */ }
        out.style.opacity = '1';
        await out.play().catch(() => {});
        await onceEnded(out, CLIP_MAX_MS);
      }
      out.style.opacity = '0';
      out.pause();

      // DARK — the lantern is empty for a beat; "it left."
      await wait(DARK_MS);

      // IN — a ribbon descends and settles back into the flame.
      if (place(inv)) {
        try { inv.currentTime = 0; } catch { /* not ready */ }
        inv.style.opacity = '1';
        await inv.play().catch(() => {});
        await onceEnded(inv, CLIP_MAX_MS);
      }
      // Hand back: relight the idle flame, then fade the clip's last frame out
      // over it so the swap is invisible.
      onActiveChange?.(false);
      await wait(200);
      inv.style.opacity = '0';
      inv.pause();
    } finally {
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

  const clipStyle = {
    position: 'fixed', left: 0, top: 0, zIndex: 40, pointerEvents: 'none',
    opacity: 0, objectFit: 'fill', transition: 'opacity .2s ease', willChange: 'opacity',
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
            <feFuncA type="gamma" amplitude="1.15" exponent="1.5" offset="0" />
          </feComponentTransfer>
        </filter>
      </svg>
      {outClip && <video ref={outRef} src={outClip} muted playsInline preload="auto" aria-hidden="true" style={clipStyle} />}
      {inClip && <video ref={inRef} src={inClip} muted playsInline preload="auto" aria-hidden="true" style={clipStyle} />}
    </>
  );
});
