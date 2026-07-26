import React, { forwardRef, useImperativeHandle, useCallback, useRef, useState } from 'react';
import flameStill from '@/assets/lantern/flame.png';

/**
 * FlyingFlame — Byte-ling's flame leaves the lantern to point at something.
 *
 * Sequence (imperative: flameRef.current.flyTo(targetEl, { hold })):
 *   1. DART   — flies out as the comet clip, rotated so its head leads the arc.
 *   2. LAND   — settles out of the comet into his normal upright flame and holds
 *               while a glow ring marks the target.
 *   3. FLICKER— flutters and dissolves back to the lantern, which relights.
 *
 * Transparency: the flame clips are flame-on-black, so a luminance→alpha SVG
 * filter (#btl-flame-alpha) keys the black to REAL transparency — it composites
 * over any colour, not just dark backgrounds (no screen-blend, no black box).
 *
 * Props:
 *   hue     : per-repo flame tint (rotates off the blue base ~200)
 *   homeRef : the lantern wrapper; the flame launches from / returns to it
 *   comet   : url of the darting comet clip (head up-right in source ≈ -44°)
 *   flame   : url of the idle flame clip used for the landed form (optional;
 *             falls back to the still image)
 */

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const reducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Run a keyframe animation, then bake its final state into inline style and
// clear the animation, so successive phases don't stack up and fight.
async function animateTo(el, keyframes, opts) {
  const a = el.animate(keyframes, { fill: 'forwards', ...opts });
  await a.finished;
  try { a.commitStyles(); } catch { /* not renderable */ }
  a.cancel();
}

const SRC_FORWARD = -44; // deg: the comet art's head points up-right in its source frame

export const FlyingFlame = forwardRef(function FlyingFlame({ hue = 200, homeRef, comet = null, flame = null }, ref) {
  const wrapRef = useRef(null);   // the moving transform anchor (0×0)
  const cometRef = useRef(null);  // comet <video>
  const flameRef = useRef(null);  // idle flame <video> (landed form)
  const [ring, setRing] = useState(null); // { left, top, width, height }
  const [phase, setPhase] = useState('idle'); // idle | dart | landed
  const [cometFailed, setCometFailed] = useState(false); // served clip 404'd → still flame
  const busy = useRef(false);
  const tint = hue == null ? 200 : hue;
  const useComet = !!comet && !cometFailed;

  const flyTo = useCallback(
    async (targetEl, { hold = 1300 } = {}) => {
      if (!targetEl || busy.current) return;
      // Never fly to a stale target: it must still be in the live DOM (not
      // removed / navigated away) and actually within the viewport — otherwise
      // the flame shoots at where something used to be.
      if (typeof document !== 'undefined' && !document.contains(targetEl)) return;
      const t = targetEl.getBoundingClientRect?.();
      if (!t || !t.width || !t.height) return;
      if (t.bottom < 0 || t.top > window.innerHeight || t.right < 0 || t.left > window.innerWidth) return;
      busy.current = true;

      const pad = 6;
      const ringBox = { left: t.left - pad, top: t.top - pad, width: t.width + pad * 2, height: t.height + pad * 2 };

      // Reduced motion: skip the flight, just pulse the ring.
      if (reducedMotion()) {
        setRing(ringBox);
        await wait(hold);
        setRing(null);
        busy.current = false;
        return;
      }

      const home = homeRef?.current?.getBoundingClientRect?.();
      const startX = home ? home.left + home.width * 0.5 : window.innerWidth - 56;
      const startY = home ? home.top + home.height * 0.52 : 72;
      const endX = t.left + t.width / 2;
      const endY = t.top + t.height / 2;

      // Arc bows perpendicular to the lantern→target line, lofting up, scaled by
      // distance, and clamped on-screen (see the demo for the derivation).
      const dx = endX - startX, dy = endY - startY;
      const dist = Math.hypot(dx, dy) || 1;
      let nx = -dy / dist, ny = dx / dist;
      if (ny > 0) { nx = -nx; ny = -ny; }
      const bow = Math.min(Math.max(dist * 0.24, 26), 150);
      const M = 10;
      const ctrlX = Math.max(M, Math.min(window.innerWidth - M, (startX + endX) / 2 + nx * bow));
      const ctrlY = Math.max(M, Math.min(window.innerHeight - M, (startY + endY) / 2 + ny * bow));

      const N = 26;
      const frames = (rev) => {
        const out = [];
        for (let i = 0; i <= N; i++) {
          const p = rev ? 1 - i / N : i / N;
          const x = (1 - p) ** 2 * startX + 2 * (1 - p) * p * ctrlX + p ** 2 * endX;
          const y = (1 - p) ** 2 * startY + 2 * (1 - p) * p * ctrlY + p ** 2 * endY;
          const s = 0.62 + 0.4 * Math.sin(Math.min(p, 1 - p) * Math.PI);
          let rot = '';
          if (useComet) {
            let tx = 2 * (1 - p) * (ctrlX - startX) + 2 * p * (endX - ctrlX);
            let ty = 2 * (1 - p) * (ctrlY - startY) + 2 * p * (endY - ctrlY);
            if (rev) { tx = -tx; ty = -ty; }
            rot = ` rotate(${Math.atan2(ty, tx) * 180 / Math.PI - SRC_FORWARD}deg)`;
          }
          out.push({ transform: `translate(${x}px, ${y}px)${rot} scale(${s})` });
        }
        return out;
      };

      const wrap = wrapRef.current;
      setPhase('dart');
      cometRef.current?.play?.().catch?.(() => {});
      wrap.style.opacity = '1';
      wrap.style.transform = `translate(${startX}px, ${startY}px) scale(0.62)`;

      // 1) dart out
      await animateTo(wrap, frames(false), { duration: 720, easing: 'cubic-bezier(.34,.16,.2,1)' });

      // 2) land → settle into the normal upright flame
      setPhase('landed');
      cometRef.current?.pause?.();
      flameRef.current?.play?.().catch?.(() => {});
      await animateTo(wrap, [
        { transform: `translate(${endX}px, ${endY}px) scale(1.18)` },
        { transform: `translate(${endX}px, ${endY}px) scale(1)` },
      ], { duration: 220, easing: 'ease-out' });

      // the ring holds the light over the target while he sits there as a flame
      setRing(ringBox);
      await wait(hold);
      setRing(null);

      // 3) flicker home; the lantern relights as this one dissolves
      await animateTo(wrap, [
        { opacity: 1 }, { opacity: .35 }, { opacity: .9 }, { opacity: .18 }, { opacity: .8 }, { opacity: 0 },
      ], { duration: 540, easing: 'ease-in-out' });
      wrap.style.opacity = '0';
      flameRef.current?.pause?.();
      setPhase('idle');
      busy.current = false;
    },
    [homeRef, useComet]
  );

  useImperativeHandle(ref, () => ({ flyTo }), [flyTo]);

  const artFilter = `hue-rotate(${tint - 200}deg) brightness(1.12) url(#btl-flame-alpha)`;

  return (
    <>
      {/* luminance→alpha key: black background → true transparency */}
      <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute' }}>
        <filter id="btl-flame-alpha" colorInterpolationFilters="sRGB">
          <feColorMatrix
            type="matrix"
            values="1 0 0 0 0
                    0 1 0 0 0
                    0 0 1 0 0
                    0.4 0.6 0.5 0 0"
          />
          <feComponentTransfer>
            <feFuncA type="gamma" amplitude="1.15" exponent="1.5" offset="0" />
          </feComponentTransfer>
        </filter>
      </svg>

      {/* the moving flame — a 0×0 transform anchor with the art centred on it */}
      <div
        ref={wrapRef}
        data-phase={phase}
        aria-hidden="true"
        className="btl-fly"
        style={{ position: 'fixed', left: 0, top: 0, width: 0, height: 0, zIndex: 60, pointerEvents: 'none', opacity: 0, willChange: 'transform' }}
      >
        {useComet ? (
          <video ref={cometRef} className="btl-fly-comet" src={comet} onError={() => setCometFailed(true)}
            muted loop playsInline style={{ filter: artFilter }} />
        ) : (
          <img className="btl-fly-still" src={flameStill} alt="" draggable="false" style={{ filter: artFilter }} />
        )}
        {flame ? (
          <video ref={flameRef} className="btl-fly-flame" src={flame} muted loop playsInline
            style={{ filter: artFilter }} />
        ) : (
          <img className="btl-fly-flame" src={flameStill} alt="" draggable="false" style={{ filter: artFilter }} />
        )}
      </div>

      {ring && (
        <div
          aria-hidden="true"
          className="btl-flyring"
          style={{
            position: 'fixed', left: ring.left, top: ring.top, width: ring.width, height: ring.height,
            zIndex: 59, pointerEvents: 'none', borderRadius: 10,
            boxShadow: `0 0 0 2px hsl(${tint} 95% 62% / .9), 0 0 16px 3px hsl(${tint} 95% 62% / .7), inset 0 0 12px hsl(${tint} 95% 62% / .35)`,
          }}
        />
      )}

      <style>{`
        .btl-fly-comet, .btl-fly-flame, .btl-fly-still {
          position: absolute; left: 0; top: 0; transform: translate(-50%, -50%);
          display: none; user-select: none; -webkit-user-drag: none;
        }
        /* comet: landscape box (matches the clip aspect, no letterbox) so the
           top-left watermark sits at the corner and a corner mask can remove it */
        .btl-fly-comet {
          width: 120px; height: 68px; object-fit: fill;
          -webkit-mask: radial-gradient(30px at 6% 10%, transparent 0 48%, #000 82%);
                  mask: radial-gradient(30px at 6% 10%, transparent 0 48%, #000 82%);
        }
        /* still-flame fallback (no comet, or the clip failed to load): square, upright */
        .btl-fly-flame, .btl-fly-still { width: 52px; height: 52px; object-fit: contain; }
        .btl-fly[data-phase="dart"]   .btl-fly-comet,
        .btl-fly[data-phase="dart"]   .btl-fly-still { display: block; }
        .btl-fly[data-phase="landed"] .btl-fly-flame { display: block; }

        .btl-flyring { animation: btl-flyring-in .32s cubic-bezier(.2,.8,.2,1) both; }
        @keyframes btl-flyring-in {
          0%   { opacity: 0; transform: scale(1.12); }
          100% { opacity: 1; transform: scale(1); }
        }
        @media (prefers-reduced-motion: reduce) { .btl-flyring { animation: none; } }
      `}</style>
    </>
  );
});
