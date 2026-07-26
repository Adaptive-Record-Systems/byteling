import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { playFlourish, pickFlourishKind, prefersReducedMotion } from '@/lib/sprenFlourish';

/**
 * SprenFlourish — a full-viewport, pointer-events-none canvas that occasionally
 * plays a brief "spren" flourish emanating from the lantern (leaves→raindrop, or
 * a drift of embers). RARE and randomised, never a loop; skipped under
 * prefers-reduced-motion. Imperative `play(kind)` lets callers (or the demo) fire
 * one on demand.
 *
 * Props:
 *   anchorRef  ref to the lantern element (flourishes start from its flame)
 *   hue        flame hue, to tint the embers/raindrop
 *   enabled    self-schedule rare flourishes (default true)
 *   minMs/maxMs randomised gap between flourishes (default 15–40 min)
 */
export const SprenFlourish = forwardRef(function SprenFlourish(
  { anchorRef, hue = 200, enabled = true, minMs = 15 * 60 * 1000, maxMs = 40 * 60 * 1000 },
  ref
) {
  const canvasRef = useRef(null);
  const activeRef = useRef(null);   // the in-flight flourish { done, cancel }
  const timerRef = useRef(null);
  const hueRef = useRef(hue);
  hueRef.current = hue;

  // Keep the canvas sized to the viewport (device-pixel-scaled).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // Where a flourish starts: the lantern's flame (center-x, a touch below center).
  const originFromAnchor = () => {
    const el = anchorRef?.current;
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.width) return { x: r.left + r.width / 2, y: r.top + r.height * 0.55 };
    }
    return { x: window.innerWidth - 60, y: 80 }; // fallback: top-right corner
  };

  const play = (kind = pickFlourishKind()) => {
    const canvas = canvasRef.current;
    if (!canvas || prefersReducedMotion()) return Promise.resolve();
    activeRef.current?.cancel();
    const handle = playFlourish(canvas, { kind, origin: originFromAnchor(), hue: hueRef.current });
    activeRef.current = handle;
    return handle.done;
  };

  useImperativeHandle(ref, () => ({ play }), []);

  // Rare self-scheduling — surprise, not wallpaper. Reschedules after each.
  useEffect(() => {
    if (!enabled || prefersReducedMotion()) return undefined;
    let stopped = false;
    const arm = () => {
      const gap = minMs + Math.random() * (maxMs - minMs);
      timerRef.current = setTimeout(async () => {
        if (stopped) return;
        // Don't fire into a backgrounded tab; just try again later.
        if (!document.hidden) {
          try { await play(); } catch { /* ignore */ }
        }
        if (!stopped) arm();
      }, gap);
    };
    arm();
    return () => {
      stopped = true;
      clearTimeout(timerRef.current);
      activeRef.current?.cancel();
    };
  }, [enabled, minMs, maxMs]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'fixed', inset: 0, width: '100%', height: '100%',
        pointerEvents: 'none', zIndex: 55,
      }}
    />
  );
});
