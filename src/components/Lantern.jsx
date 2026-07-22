import React, { useEffect, useRef, useState } from 'react';

/**
 * Byteling's character: a small hanging lantern with a living flame.
 *
 * The lantern is the house — it stays fixed. The flame is the living part:
 * it rests and breathes on its own, brightens when something in the repo is
 * worth noticing, and dims to almost nothing when you're deep in flow.
 *
 * Motion is tied to EVENTS, not a timer. The resting flicker is natural (a
 * flame is alive), but the flame only *reaches out* — drift/notice/spark —
 * when a real thing happens (repo opened, fix proposed, PR landed). "A flame
 * that dances on a loop becomes wallpaper you stop seeing."
 *
 * ── Placeholder visual ──────────────────────────────────────────────
 * The SVG below is a stand-in. To drop in rendered art or a looping video
 * later, replace the <svg> in `LanternBody` with an <img>/<video> per mood
 * and keep the same prop contract (mood, pulse, hue). Everything else — the
 * state machine, the reactions, the tint — stays as-is.
 *
 * Props:
 *   mood  : 'resting' | 'thinking' | 'dim'   steady state
 *   pulse : { id, kind }                      one-shot reaction; bump `id`
 *           kind: 'drift'  repo opened   — flame reaches out to the new repo
 *                 'notice' fix proposed  — flame leans in, curious
 *                 'spark'  PR landed     — bright celebratory flare
 *   hue   : number (0–360)                    per-repo flame tint; null = amber
 */

const REACTION_MS = 1400;

export function Lantern({ mood = 'resting', pulse, hue = null, className = '' }) {
  const [reaction, setReaction] = useState(null);
  const lastPulse = useRef(null);

  useEffect(() => {
    if (!pulse || pulse.id === lastPulse.current) return;
    lastPulse.current = pulse.id;
    setReaction(pulse.kind);
    const t = setTimeout(() => setReaction(null), REACTION_MS);
    return () => clearTimeout(t);
  }, [pulse]);

  // The flame carries a faint tint from the open repo; amber when none is open.
  const tint = hue == null ? 42 : hue;
  const state = reaction || mood;

  return (
    <div
      className={`btl-lantern btl-${state} ${className}`}
      style={{ '--btl-hue': tint }}
      role="img"
      aria-label={`Byteling — ${reaction ? `${reaction}` : mood}`}
    >
      <LanternBody />
      <LanternStyles />
    </div>
  );
}

/** A tiny inline flame, for headers/avatars where the full lantern is too big. */
export function FlameMark({ className = '', hue = 42 }) {
  return (
    <span
      className={`btl-mark ${className}`}
      style={{ '--btl-hue': hue }}
      aria-hidden="true"
    >
      <span className="btl-mark-flame" />
      <LanternStyles />
    </span>
  );
}

function LanternBody() {
  return (
    <svg viewBox="0 0 80 120" width="100%" height="100%" aria-hidden="true">
      {/* cord + hook */}
      <line x1="40" y1="0" x2="40" y2="14" className="btl-metal" strokeWidth="2" />
      <circle cx="40" cy="4" r="3" className="btl-metal-fill" />

      {/* lantern cap */}
      <path d="M26 20 L54 20 L48 14 L32 14 Z" className="btl-metal-fill" />
      <rect x="30" y="20" width="20" height="4" rx="1" className="btl-metal-fill" />

      {/* glass housing */}
      <rect x="22" y="26" width="36" height="64" rx="8" className="btl-glass" />
      <rect x="22" y="26" width="36" height="64" rx="8" className="btl-frame" fill="none" strokeWidth="2.5" />

      {/* base */}
      <rect x="26" y="90" width="28" height="6" rx="2" className="btl-metal-fill" />
      <rect x="30" y="96" width="20" height="5" rx="2" className="btl-metal-fill" />

      {/* the living flame — the part that reacts */}
      <g className="btl-flame-group" style={{ transformOrigin: '40px 74px' }}>
        <ellipse cx="40" cy="70" rx="20" ry="26" className="btl-glow" />
        <path
          className="btl-flame"
          d="M40 44
             C 50 56, 54 64, 52 72
             C 51 80, 46 84, 40 84
             C 34 84, 29 80, 28 72
             C 26 64, 30 56, 40 44 Z"
        />
        <path
          className="btl-flame-core"
          d="M40 56
             C 45 63, 46 68, 45 73
             C 44 78, 42 80, 40 80
             C 38 80, 36 78, 35 73
             C 34 68, 35 63, 40 56 Z"
        />
      </g>
    </svg>
  );
}

function LanternStyles() {
  return (
    <style>{`
      .btl-lantern {
        display: inline-block;
        width: 64px;
        height: 96px;
        --flame: hsl(var(--btl-hue) 92% 60%);
        --flame-hot: hsl(calc(var(--btl-hue) + 8) 100% 78%);
        --flame-core: hsl(calc(var(--btl-hue) + 20) 100% 92%);
        --glow: hsl(var(--btl-hue) 95% 62%);
      }
      .btl-metal { stroke: hsl(0 0% 55%); }
      .btl-metal-fill { fill: hsl(0 0% 42%); }
      .btl-frame { stroke: hsl(0 0% 38%); }
      .btl-glass { fill: hsl(var(--btl-hue) 40% 50% / 0.06); }

      .btl-glow {
        fill: var(--glow);
        opacity: 0.28;
        filter: blur(6px);
        transform-origin: 40px 74px;
        transition: opacity 0.4s ease;
      }
      .btl-flame {
        fill: var(--flame);
        transform-origin: 40px 74px;
      }
      .btl-flame-core {
        fill: var(--flame-core);
        transform-origin: 40px 74px;
      }
      .btl-flame-group {
        transition: transform 0.4s cubic-bezier(.2,.8,.2,1);
      }

      /* Resting: the flame is alive — a gentle breathing flicker, in place. */
      .btl-resting .btl-flame { animation: btl-flicker 2.6s ease-in-out infinite; }
      .btl-resting .btl-flame-core { animation: btl-flicker 1.9s ease-in-out infinite; }
      .btl-resting .btl-glow { opacity: 0.26; animation: btl-breathe 3.4s ease-in-out infinite; }

      /* Thinking: quicker, busier flicker — Byteling is working. */
      .btl-thinking .btl-flame { animation: btl-flicker 0.7s ease-in-out infinite; }
      .btl-thinking .btl-flame-core { animation: btl-flicker 0.5s ease-in-out infinite; }
      .btl-thinking .btl-glow { opacity: 0.42; animation: btl-breathe 0.9s ease-in-out infinite; }

      /* Dim: deep in flow, doesn't need you — flame shrinks to almost nothing. */
      .btl-dim .btl-flame-group { transform: scaleY(0.5) translateY(10px); }
      .btl-dim .btl-flame { fill: hsl(var(--btl-hue) 60% 46%); animation: btl-flicker 4s ease-in-out infinite; }
      .btl-dim .btl-glow { opacity: 0.08; }

      /* Drift: repo opened — the flame reaches out toward the new file, then zips home. */
      .btl-drift .btl-flame-group { animation: btl-reach 1.4s cubic-bezier(.3,.7,.2,1); }
      .btl-drift .btl-glow { opacity: 0.5; }

      /* Notice: a fix is proposed — the flame leans in, curious. */
      .btl-notice .btl-flame-group { animation: btl-lean 1.4s ease-in-out; }
      .btl-notice .btl-glow { opacity: 0.46; }

      /* Spark: a PR landed — a bright, celebratory flare. */
      .btl-spark .btl-flame-group { animation: btl-flare 1.4s cubic-bezier(.2,.9,.2,1); }
      .btl-spark .btl-flame { fill: var(--flame-hot); }
      .btl-spark .btl-glow { opacity: 0.7; }

      @keyframes btl-flicker {
        0%, 100% { transform: scaleY(1) scaleX(1); opacity: 1; }
        30%      { transform: scaleY(1.06) scaleX(0.97); opacity: 0.92; }
        55%      { transform: scaleY(0.95) scaleX(1.03); opacity: 1; }
        75%      { transform: scaleY(1.03) scaleX(0.98); opacity: 0.95; }
      }
      @keyframes btl-breathe {
        0%, 100% { opacity: 0.24; }
        50%      { opacity: 0.34; }
      }
      @keyframes btl-reach {
        0%   { transform: translate(0,0) scale(1); }
        35%  { transform: translate(9px,-8px) scale(1.12); }
        60%  { transform: translate(6px,-5px) scale(1.08); }
        100% { transform: translate(0,0) scale(1); }
      }
      @keyframes btl-lean {
        0%, 100% { transform: rotate(0deg) scale(1); }
        40%      { transform: rotate(-7deg) scale(1.08); }
        70%      { transform: rotate(-4deg) scale(1.05); }
      }
      @keyframes btl-flare {
        0%   { transform: scale(1); }
        25%  { transform: scale(1.28) translateY(-4px); }
        50%  { transform: scale(1.12); }
        100% { transform: scale(1); }
      }

      /* Tiny flame mark for headers/avatars. */
      .btl-mark {
        --flame: hsl(var(--btl-hue) 92% 58%);
        --flame-core: hsl(calc(var(--btl-hue) + 20) 100% 90%);
        position: relative;
        display: inline-flex;
        width: 1em; height: 1em;
        align-items: center; justify-content: center;
      }
      .btl-mark-flame {
        width: 0.62em; height: 0.82em;
        background: radial-gradient(ellipse at 50% 75%, var(--flame-core) 0%, var(--flame) 55%, transparent 100%);
        border-radius: 50% 50% 50% 50% / 62% 62% 38% 38%;
        transform: rotate(-2deg);
        animation: btl-flicker 2.2s ease-in-out infinite;
        box-shadow: 0 0 6px hsl(var(--btl-hue) 95% 60% / 0.5);
      }

      @media (prefers-reduced-motion: reduce) {
        .btl-flame, .btl-flame-core, .btl-glow, .btl-flame-group, .btl-mark-flame {
          animation: none !important;
        }
      }
    `}</style>
  );
}

/** Stable 0–360 hue from a repo name, so each repo reads as its own color. */
export function hueFromRepo(fullName) {
  if (!fullName) return null;
  let h = 0;
  for (let i = 0; i < fullName.length; i++) h = (h * 31 + fullName.charCodeAt(i)) % 360;
  return h;
}
