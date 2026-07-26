// Spren flourishes — rare, brief, ignorable moments where Byte's flame does
// something playful (Syl-like), then it's gone. Canvas particles, no new art.
//
// Load-bearing constraint: NOT overbearing. These are surprise, not wallpaper —
// fired on a long randomised timer (never a loop), brief, non-blocking (the host
// canvas is pointer-events:none), and skipped entirely under prefers-reduced-
// motion. This module is framework-free so the React wrapper and the dev tuning
// page (/spren-demo.html) share one engine.

const rand = (a, b) => a + Math.random() * (b - a);

export const FLOURISH_KINDS = ['leaves', 'motes'];
// 'humanoid' (the flame briefly taking a little figure) is the future art-driven
// variant — deliberately not here yet; these two are the CSS/canvas first slice.

export function prefersReducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }
}

export function pickFlourishKind() {
  return FLOURISH_KINDS[Math.floor(Math.random() * FLOURISH_KINDS.length)];
}

// ── particle builders ───────────────────────────────────────────────────────

// A little gust of leaves that blows up and out from the flame, then a single
// raindrop drifts back down through them — the user's marquee example.
function buildLeaves(origin, hue) {
  const parts = [];
  const leafColors = ['#7ba05b', '#a7c06a', '#c9a34e', '#b5843a', '#8fae57'];
  const n = 8;
  for (let i = 0; i < n; i++) {
    parts.push({
      type: 'leaf',
      x: origin.x + rand(-6, 6),
      y: origin.y + rand(-6, 6),
      vx: rand(-70, 70),
      vy: rand(-230, -150),     // burst upward
      gravity: rand(140, 200),  // then settle back down
      swayAmp: rand(10, 26),
      swayFreq: rand(1.6, 3.0),
      swayPhase: rand(0, Math.PI * 2),
      size: rand(6, 10),
      rot: rand(0, Math.PI * 2),
      vrot: rand(-3, 3),
      color: leafColors[i % leafColors.length],
      born: 0,
      life: rand(1500, 2100),
      delay: rand(0, 120),
    });
  }
  // One raindrop, launched a touch later, from above — falls to the flame and splashes.
  parts.push({
    type: 'drop',
    x: origin.x + rand(-4, 4),
    y: origin.y - rand(120, 170),
    vx: rand(-10, 10),
    vy: rand(120, 170),
    gravity: 320,
    size: rand(3.5, 5),
    landY: origin.y,
    splashed: false,
    hue,
    born: 0,
    life: 1600,
    delay: rand(500, 700),
  });
  return parts;
}

// A quiet upward drift of glowing embers, tinted like the flame. The gentler,
// more frequent variety.
function buildMotes(origin, hue) {
  const parts = [];
  const n = 16;
  for (let i = 0; i < n; i++) {
    parts.push({
      type: 'mote',
      x: origin.x + rand(-5, 5),
      y: origin.y + rand(-4, 8),
      vx: rand(-24, 24),
      vy: rand(-90, -40),
      gravity: rand(-10, 10),
      size: rand(1.4, 3.2),
      hue: hue + rand(-14, 14),
      twinkle: rand(6, 12),
      phase: rand(0, Math.PI * 2),
      born: 0,
      life: rand(1100, 1800),
      delay: rand(0, 500),
    });
  }
  return parts;
}

function buildParticles(kind, origin, hue) {
  return kind === 'motes' ? buildMotes(origin, hue) : buildLeaves(origin, hue);
}

// ── drawing ─────────────────────────────────────────────────────────────────

function drawLeaf(ctx, p, alpha) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rot);
  ctx.globalAlpha = alpha * 0.9;
  const s = p.size;
  ctx.fillStyle = p.color;
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.quadraticCurveTo(s * 0.75, 0, 0, s);
  ctx.quadraticCurveTo(-s * 0.75, 0, 0, -s);
  ctx.fill();
  ctx.globalAlpha = alpha * 0.5;
  ctx.strokeStyle = 'rgba(60,70,40,0.9)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.8);
  ctx.lineTo(0, s * 0.8);
  ctx.stroke();
  ctx.restore();
}

function drawDrop(ctx, p, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha * 0.8;
  const s = p.size;
  const g = ctx.createLinearGradient(p.x, p.y - s * 2, p.x, p.y + s);
  g.addColorStop(0, `hsla(${p.hue}, 90%, 85%, 0.9)`);
  g.addColorStop(1, `hsla(${p.hue}, 85%, 60%, 0.7)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y - s * 2.2);         // pointed top
  ctx.quadraticCurveTo(p.x + s, p.y, p.x, p.y + s);
  ctx.quadraticCurveTo(p.x - s, p.y, p.x, p.y - s * 2.2);
  ctx.fill();
  ctx.restore();
}

function drawSplash(ctx, p, t) {
  const age = t - p.splashAt;
  const dur = 420;
  if (age > dur) return false;
  const k = age / dur;
  ctx.save();
  ctx.globalAlpha = (1 - k) * 0.6;
  ctx.strokeStyle = `hsl(${p.hue}, 85%, 72%)`;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(p.x, p.landY, 3 + k * 16, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  return true;
}

function drawMote(ctx, p, alpha, t) {
  const flick = 0.6 + 0.4 * Math.sin((t / 1000) * p.twinkle + p.phase);
  const s = p.size;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = alpha * flick;
  const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, s * 3);
  g.addColorStop(0, `hsla(${p.hue}, 100%, 85%, 1)`);
  g.addColorStop(0.4, `hsla(${p.hue}, 95%, 62%, 0.7)`);
  g.addColorStop(1, `hsla(${p.hue}, 90%, 50%, 0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(p.x, p.y, s * 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ── the loop ────────────────────────────────────────────────────────────────

// Play one flourish on `canvas` (already sized to the viewport by the caller).
// origin = {x, y} viewport px; hue tints the flame-coloured bits. Returns a
// promise that resolves when the flourish finishes. Cancellable via the returned
// object's .cancel().
export function playFlourish(canvas, { kind = 'leaves', origin, hue = 200 } = {}) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const parts = buildParticles(kind, origin, hue);
  let raf = 0;
  let start = 0;
  let cancelled = false;

  const done = new Promise((resolve) => {
    const frame = (now) => {
      if (cancelled) return resolve();
      if (!start) start = now;
      const t = now - start;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

      let alive = false;
      for (const p of parts) {
        const local = t - p.delay;
        if (local < 0) { alive = true; continue; }
        if (local > p.life && !(p.type === 'drop' && p.splashed)) continue;

        const dt = Math.min(local - (p.born || 0), 40) / 1000; // clamp for tab-switch jumps
        p.born = local;

        // integrate
        p.vy += (p.gravity || 0) * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.vrot) p.rot += p.vrot * dt;

        const k = local / p.life;
        const alpha = k < 0.15 ? k / 0.15 : (1 - (k - 0.15) / 0.85); // ease in, long fade

        if (p.type === 'leaf') {
          const sway = Math.sin((local / 1000) * p.swayFreq + p.swayPhase) * p.swayAmp * dt;
          p.x += sway;
          drawLeaf(ctx, p, Math.max(0, alpha));
          alive = true;
        } else if (p.type === 'drop') {
          if (!p.splashed && p.y >= p.landY) {
            p.splashed = true;
            p.splashAt = t;
          }
          if (p.splashed) {
            if (drawSplash(ctx, p, t)) alive = true;
          } else {
            drawDrop(ctx, p, Math.max(0, alpha));
            alive = true;
          }
        } else if (p.type === 'mote') {
          drawMote(ctx, p, Math.max(0, alpha), t);
          alive = true;
        }
      }

      if (alive) {
        raf = requestAnimationFrame(frame);
      } else {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
        resolve();
      }
    };
    raf = requestAnimationFrame(frame);
  });

  return { done, cancel: () => { cancelled = true; cancelAnimationFrame(raf); } };
}
