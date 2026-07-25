import React, { forwardRef, useImperativeHandle, useCallback, useEffect, useRef, useState } from 'react';
import flameImg from '@/assets/lantern/flame.png';

/**
 * FlyingFlame — Byte-ling's living flame can leave the lantern, dart across the
 * screen to a target element, ring it with a glow, and return home. The lantern
 * (the "house") stays put; this is the flame acting as a pointer — "look here."
 *
 * Imperative API via ref:
 *   flameRef.current.flyTo(targetEl, { hold?: ms })
 *
 * `homeRef` is the lantern wrapper element; the flame launches from ~its chamber
 * and returns there. Motion is a quadratic arc (a swoop), not a straight slide.
 * Respects prefers-reduced-motion (skips the flight, just rings the target).
 */

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const reducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const FlyingFlame = forwardRef(function FlyingFlame({ hue = 200, homeRef, video = null }, ref) {
  const flameRef = useRef(null);
  const videoRef = useRef(null);
  const [ring, setRing] = useState(null); // { left, top, width, height }
  const [flying, setFlying] = useState(false);
  const busy = useRef(false);
  const tint = hue == null ? 200 : hue;

  // Only run the flame video while it's actually out flying — no idle decode.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (flying) { const p = v.play(); if (p && p.catch) p.catch(() => {}); }
    else v.pause();
  }, [flying]);

  const flyTo = useCallback(
    async (targetEl, { hold = 1300 } = {}) => {
      if (!targetEl || busy.current) return;
      const target = targetEl.getBoundingClientRect?.();
      if (!target || target.width === 0) return;
      busy.current = true;

      const pad = 6;
      const ringBox = {
        left: target.left - pad,
        top: target.top - pad,
        width: target.width + pad * 2,
        height: target.height + pad * 2,
      };

      // Reduced motion: skip the flight, just pulse the ring on the target.
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
      const endX = target.left + target.width / 2;
      const endY = target.top + target.height / 2;

      // Bow the arc perpendicular to the straight lantern→target line, lofting
      // upward and scaling with distance — so the curve bends by WHERE the target
      // is relative to the lantern: a short hop barely curves, a long cross-screen
      // trip sweeps high, and left/right/down each bend their own way.
      const dx = endX - startX;
      const dy = endY - startY;
      const dist = Math.hypot(dx, dy) || 1;
      let nx = -dy / dist; // perpendicular to the path…
      let ny = dx / dist;
      if (ny > 0) { nx = -nx; ny = -ny; } // …chosen so the arc always lofts upward
      const bow = Math.min(Math.max(dist * 0.24, 26), 150);
      // Keep the control point on-screen so a near-edge flight (e.g. lantern →
      // repo pill, both near the top) just flattens instead of arcing off-screen.
      const M = 10;
      const ctrlX = Math.max(M, Math.min(window.innerWidth - M, (startX + endX) / 2 + nx * bow));
      const ctrlY = Math.max(M, Math.min(window.innerHeight - M, (startY + endY) / 2 + ny * bow));

      const N = 26;
      const frames = (reverse) => {
        const out = [];
        for (let i = 0; i <= N; i++) {
          const p = reverse ? 1 - i / N : i / N;
          const x = (1 - p) ** 2 * startX + 2 * (1 - p) * p * ctrlX + p ** 2 * endX;
          const y = (1 - p) ** 2 * startY + 2 * (1 - p) * p * ctrlY + p ** 2 * endY;
          // grow a touch mid-flight so it reads as coming toward you, then settle
          const s = 0.62 + 0.4 * Math.sin(Math.min(p, 1 - p) * Math.PI);
          out.push({ transform: `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${s})` });
        }
        return out;
      };

      const flame = flameRef.current;
      setFlying(true);
      // seat it at the start point before revealing, so it never flashes at 0,0
      flame.style.transform = `translate(${startX}px, ${startY}px) translate(-50%, -50%) scale(0.62)`;

      await flame.animate(frames(false), {
        duration: 720,
        easing: 'cubic-bezier(.34,.16,.2,1)',
        fill: 'forwards',
      }).finished;

      setRing(ringBox);
      await wait(hold);
      setRing(null);

      await flame.animate(frames(true), {
        duration: 620,
        easing: 'cubic-bezier(.4,0,.4,1)',
        fill: 'forwards',
      }).finished;

      setFlying(false);
      busy.current = false;
    },
    [homeRef]
  );

  useImperativeHandle(ref, () => ({ flyTo }), [flyTo]);

  return (
    <>
      {/* the travelling flame — screen-blended so its black backdrop vanishes */}
      <div
        ref={flameRef}
        aria-hidden="true"
        style={{
          position: 'fixed',
          left: 0,
          top: 0,
          zIndex: 60,
          pointerEvents: 'none',
          width: 46,
          height: 46,
          opacity: flying ? 1 : 0,
          transition: flying ? 'none' : 'opacity .22s ease',
          willChange: 'transform',
        }}
      >
        <span
          style={{
            position: 'absolute',
            inset: '-45%',
            background: `radial-gradient(circle at 50% 55%, hsl(${tint} 95% 62% / .55), transparent 70%)`,
            filter: 'blur(4px)',
            mixBlendMode: 'screen',
          }}
        />
        {video ? (
          <video
            ref={videoRef}
            src={video}
            muted
            loop
            playsInline
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              mixBlendMode: 'screen',
              filter: `hue-rotate(${tint - 200}deg) brightness(1.15)`,
            }}
          />
        ) : (
          <img
            src={flameImg}
            alt=""
            draggable="false"
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              mixBlendMode: 'screen',
              filter: `hue-rotate(${tint - 200}deg) brightness(1.15)`,
            }}
          />
        )}
      </div>

      {/* glow ring on the target */}
      {ring && (
        <div
          aria-hidden="true"
          className="btl-flyring"
          style={{
            position: 'fixed',
            left: ring.left,
            top: ring.top,
            width: ring.width,
            height: ring.height,
            zIndex: 59,
            pointerEvents: 'none',
            borderRadius: 10,
            boxShadow: `0 0 0 2px hsl(${tint} 95% 62% / .9), 0 0 16px 3px hsl(${tint} 95% 62% / .7), inset 0 0 12px hsl(${tint} 95% 62% / .35)`,
          }}
        />
      )}

      <style>{`
        .btl-flyring { animation: btl-flyring-in .32s cubic-bezier(.2,.8,.2,1) both; }
        @keyframes btl-flyring-in {
          0%   { opacity: 0; transform: scale(1.12); }
          100% { opacity: 1; transform: scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .btl-flyring { animation: none; }
        }
      `}</style>
    </>
  );
});
