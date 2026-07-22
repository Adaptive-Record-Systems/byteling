import React, { useEffect, useRef, useState } from 'react';
import bodyRest from '@/assets/lantern/body-rest.png';
import bodyOpen from '@/assets/lantern/body-open.png';
import flameImg from '@/assets/lantern/flame.png';

/**
 * Byteling's character: a small hanging lantern with a living flame.
 *
 * The lantern is the house — it stays fixed. The flame is the living part:
 * it rests and breathes on its own, brightens when something in the repo is
 * worth noticing, and dims to almost nothing when you're deep in flow. The
 * lantern's WINGS open when it comes alive (a reaction is engaged) and stay
 * shut when it's resting or asleep — the body reacts, not just the flame.
 *
 * Motion is tied to EVENTS, not a timer. The resting flicker is natural (a
 * flame is alive), but the wings/flame only *reach out* — drift/notice/spark —
 * when a real thing happens (repo opened, fix proposed, PR landed).
 *
 * ── Layered art stack ───────────────────────────────────────────────
 * Two keyed (transparent) renders of the petal-ovoid vessel, cross-faded:
 *   body-rest.png  wings shut   — resting / dim
 *   body-open.png  wings open   — thinking / drift / notice / spark
 * plus a flame in the chamber seat. The flame here is an interim CSS flame.
 * To swap in a real flame clip: render it on a BLACK background and drop a
 * <video> into `.btl-flame-slot` with `mix-blend-mode: screen` — the black
 * vanishes, only the flame shows, no alpha needed. To upgrade the wings to
 * video, replace the two <img> with a reaction <video>. The prop contract
 * (mood, pulse, hue) stays identical either way.
 *
 * Props:
 *   mood  : 'resting' | 'thinking' | 'dim'   steady state
 *   pulse : { id, kind }                      one-shot reaction; bump `id`
 *           kind: 'drift'  repo opened   — wings open, flame reaches out
 *                 'notice' fix proposed  — wings open, flame leans in
 *                 'spark'  PR landed     — wings open, bright celebratory flare
 *   hue   : number (0–360)                    per-repo flame tint; null = amber
 */

const REACTION_MS = 1600;
const WINGS_OPEN = new Set(['thinking', 'drift', 'notice', 'spark']);

export function Lantern({ mood = 'resting', pulse, hue = null, className = '', flameVideo = null, size = 160 }) {
  const [reaction, setReaction] = useState(null);
  const lastPulse = useRef(null);
  const videoRef = useRef(null);

  useEffect(() => {
    if (!pulse || pulse.id === lastPulse.current) return;
    lastPulse.current = pulse.id;
    setReaction(pulse.kind);
    const t = setTimeout(() => setReaction(null), REACTION_MS);
    return () => clearTimeout(t);
  }, [pulse]);

  // Background tabs pause the flame video; a screen-blended <video> then shows
  // a stale/torn frame on return. Resume + nudge a repaint when visible again.
  useEffect(() => {
    if (!flameVideo) return;
    const kick = () => {
      const v = videoRef.current;
      if (!v || document.visibilityState !== 'visible') return;
      const p = v.play();
      if (p && p.catch) p.catch(() => {});
    };
    document.addEventListener('visibilitychange', kick);
    window.addEventListener('focus', kick);
    return () => {
      document.removeEventListener('visibilitychange', kick);
      window.removeEventListener('focus', kick);
    };
  }, [flameVideo]);

  // The flame carries a tint from the open repo; the art is blue (~200), so
  // that's the default and per-repo hues rotate the flame away from it.
  const tint = hue == null ? 200 : hue;
  const state = reaction || mood;
  const wingsOpen = WINGS_OPEN.has(state);

  return (
    <div
      className={`btl-lantern btl-${state} ${wingsOpen ? 'btl-wings-open' : ''} ${className}`}
      style={{ '--btl-hue': tint, '--btl-size': typeof size === 'number' ? `${size}px` : size }}
      role="img"
      aria-label={`Byteling — ${reaction || mood}`}
    >
      {/* wings-shut base */}
      <img className="btl-body btl-body-rest" src={bodyRest} alt="" draggable="false" />
      {/* wings-open overlay, cross-faded in when a reaction engages */}
      <img className="btl-body btl-body-open" src={bodyOpen} alt="" draggable="false" />
      {/* the living flame — a flame-on-black render, screen-blended so the black
          vanishes. Swap the <img> for a <video> loop later, same slot. */}
      <span className="btl-flame-slot">
        <span className="btl-flame-glow" />
        {flameVideo ? (
          <video
            ref={videoRef}
            className="btl-flame-img"
            src={flameVideo}
            poster={flameImg}
            autoPlay
            muted
            loop
            playsInline
            aria-hidden="true"
          />
        ) : (
          <img className="btl-flame-img" src={flameImg} alt="" draggable="false" />
        )}
      </span>
      <LanternStyles />
    </div>
  );
}

/** A tiny inline flame, for headers/avatars where the full lantern is too big. */
export function FlameMark({ className = '', hue = 200 }) {
  return (
    <span className={`btl-mark ${className}`} style={{ '--btl-hue': hue }} aria-hidden="true">
      <span className="btl-mark-flame" />
      <LanternStyles />
    </span>
  );
}

function LanternStyles() {
  return (
    <style>{`
      .btl-lantern {
        position: relative;
        display: inline-block;
        width: var(--btl-size, 160px);
        aspect-ratio: 1 / 1;
        --glow: hsl(var(--btl-hue) 95% 62%);
        /* the flame art is blue (~200); per-repo hue rotates it away from blue */
        --flame-rot: calc((var(--btl-hue) - 200) * 1deg);
      }
      .btl-body {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: contain;
        user-select: none;
        -webkit-user-drag: none;
      }
      /* Cross-fade between wings-shut and wings-open. */
      .btl-body-open { opacity: 0; transition: opacity .5s cubic-bezier(.2,.8,.2,1); }
      .btl-body-rest { opacity: 1; transition: opacity .5s cubic-bezier(.2,.8,.2,1); }
      .btl-wings-open .btl-body-open { opacity: 1; }
      .btl-wings-open .btl-body-rest { opacity: 0; }

      /* Flame lives inside the chamber, rising from the brass seat. The art is
         a flame on black; mix-blend-mode:screen makes the black disappear. */
      /* Clip the flame to the chamber opening so it stays *inside* the vessel
         and never renders in front of the surrounding frame — regardless of
         flame size or the reach/flare animations. */
      .btl-flame-slot {
        position: absolute; inset: 0; pointer-events: none;
        clip-path: ellipse(9.8% 11% at 50.5% 55%);
      }
      .btl-flame-img {
        position: absolute;
        left: 50.5%; bottom: 30%;
        width: 29%; height: auto;
        transform: translateX(-50%);
        transform-origin: 50% 100%;
        mix-blend-mode: screen;
        filter: hue-rotate(var(--flame-rot));
      }
      .btl-flame-glow {
        position: absolute;
        left: 50.5%; bottom: 30%;
        width: 46%; height: 24%;
        transform: translateX(-50%);
        background: radial-gradient(ellipse at 50% 72%, var(--glow) 0%, transparent 72%);
        opacity: .55;
        filter: blur(5px);
        mix-blend-mode: screen;
        transition: opacity .4s ease;
      }

      /* Resting: alive but calm. The static image flickers via CSS; a <video>
         flame supplies its own motion, so only img.btl-flame-img gets btl-flicker. */
      .btl-resting img.btl-flame-img { animation: btl-flicker 2.6s ease-in-out infinite; }
      .btl-resting .btl-flame-glow   { opacity: .6; animation: btl-breathe 3.4s ease-in-out infinite; }

      /* Thinking: quicker, busier flicker — Byteling is working, wings open. */
      .btl-thinking img.btl-flame-img { animation: btl-flicker .7s ease-in-out infinite; }
      .btl-thinking .btl-flame-glow   { opacity: .62; animation: btl-breathe .9s ease-in-out infinite; }

      /* Dim: deep in flow — wings shut, flame shrinks to almost nothing. */
      .btl-dim .btl-flame-img      { transform: translateX(-50%) scaleY(.5); opacity: .55; }
      .btl-dim img.btl-flame-img   { animation: btl-flicker 4.5s ease-in-out infinite; }
      .btl-dim .btl-flame-glow     { opacity: .12; }

      /* Drift: repo opened — flame reaches up as the wings swing open. */
      .btl-drift .btl-flame-img  { animation: btl-reach 1.6s cubic-bezier(.3,.7,.2,1); }
      .btl-drift .btl-flame-glow { opacity: .72; }

      /* Notice: a fix is proposed — flame leans in, curious. */
      .btl-notice .btl-flame-img  { animation: btl-lean 1.6s ease-in-out; }
      .btl-notice .btl-flame-glow { opacity: .66; }

      /* Spark: a PR landed — a bright, celebratory flare. */
      .btl-spark .btl-flame-img  { filter: hue-rotate(var(--flame-rot)) brightness(1.4); animation: btl-flare 1.6s cubic-bezier(.2,.9,.2,1); }
      .btl-spark .btl-flame-glow { opacity: .95; }

      @keyframes btl-flicker {
        0%, 100% { transform: translateX(-50%) scaleY(1) scaleX(1); }
        30%      { transform: translateX(-50%) scaleY(1.07) scaleX(.96); }
        55%      { transform: translateX(-50%) scaleY(.95) scaleX(1.04); }
        75%      { transform: translateX(-50%) scaleY(1.04) scaleX(.98); }
      }
      @keyframes btl-breathe { 0%,100% { opacity: .58; } 50% { opacity: .78; } }
      @keyframes btl-reach {
        0%   { transform: translateX(-50%) scaleY(1); }
        35%  { transform: translateX(-50%) scaleY(1.5) translateY(-8%); }
        60%  { transform: translateX(-50%) scaleY(1.3) translateY(-4%); }
        100% { transform: translateX(-50%) scaleY(1); }
      }
      @keyframes btl-lean {
        0%,100% { transform: translateX(-50%) rotate(0) scaleY(1); }
        40%     { transform: translateX(-52%) rotate(-8deg) scaleY(1.2); }
        70%     { transform: translateX(-51%) rotate(-4deg) scaleY(1.1); }
      }
      @keyframes btl-flare {
        0%   { transform: translateX(-50%) scale(1); }
        25%  { transform: translateX(-50%) scale(1.55) translateY(-6%); }
        50%  { transform: translateX(-50%) scale(1.2); }
        100% { transform: translateX(-50%) scale(1); }
      }

      /* Tiny flame mark for headers/avatars. */
      .btl-mark {
        --flame: hsl(var(--btl-hue) 95% 60%);
        --flame-core: hsl(calc(var(--btl-hue) + 22) 100% 94%);
        position: relative;
        display: inline-flex;
        width: 1em; height: 1em;
        align-items: center; justify-content: center;
      }
      .btl-mark-flame {
        width: 0.72em; height: 0.94em;
        background: radial-gradient(ellipse at 50% 74%, #fff 0%, var(--flame-core) 34%, var(--flame) 66%, transparent 100%);
        border-radius: 50% 50% 50% 50% / 62% 62% 38% 38%;
        transform: rotate(-2deg);
        animation: btl-markflick 2.2s ease-in-out infinite;
        box-shadow: 0 0 8px hsl(var(--btl-hue) 98% 62% / 0.8), 0 0 3px hsl(var(--btl-hue) 100% 78% / 0.9);
      }
      @keyframes btl-markflick {
        0%,100% { transform: rotate(-2deg) scaleY(1); opacity: 1; }
        50%     { transform: rotate(-2deg) scaleY(1.08); opacity: .9; }
      }

      @media (prefers-reduced-motion: reduce) {
        .btl-flame-shape, .btl-flame-glow, .btl-body, .btl-mark-flame { animation: none !important; transition: none !important; }
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
