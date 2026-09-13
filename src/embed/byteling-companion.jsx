import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Lantern, FlameMark } from '@/components/Lantern';
import { FlyingFlame } from '@/components/FlyingFlame';
import { LanternFlourish, isFlourishRequest, flourishLine } from '@/components/LanternFlourish';
import { extractName } from '@/lib/name';

// The <script> tag that loaded this bundle — captured at load so auto-mount can
// read its data-* config (data-hue / data-size) even after DOM ready.
const SELF_SCRIPT = typeof document !== 'undefined' ? document.currentScript : null;

/**
 * <byteling-companion> — the embeddable Byteling companion.
 *
 * Drop-in for ANY page (React, Vue, plain HTML, another Base44 app):
 *   <script src="https://byteling-baas-417f0fd8.base44.app/embed.js"></script>
 *   <byteling-companion></byteling-companion>
 *
 * A lantern docks in a corner; clicking it expands a chat panel. Everything
 * lives in a Shadow DOM so the host page's CSS can't touch it and ours can't
 * leak out. This step is the dock + chat UI + interaction loop; real chat is
 * gated behind a "sign in" preview until the popup-auth step lands (the send
 * path in `submit()` is where the backend call drops in once we have a token).
 *
 * Attributes:
 *   hue="210"   optional 0–360 flame tint (default warm amber)
 *   size="72"   optional px width of the docked lantern (default 72)
 */

const OPEN_MS = 260;

// The embed always talks to the CLI-created Byteling backend, cross-origin.
const BYTELING_BASE = 'https://byteling-baas-417f0fd8.base44.app';
const BYTELING_APP_ID = '6a61038cc4bec6bf417f0fd8';
const TOKEN_KEY = 'byteling_embed_token';
const NAME_KEY = 'byteling_embed_name';  // the user's first name, for greetings
const POS_KEY = 'byteling_embed_pos';    // { left, top } once the user moves it
const SIZE_KEY = 'byteling_embed_size';  // dock px width once the user resizes it
const DOCK_MIN = 48;
const DOCK_MAX = 240;

// Running as the Chrome/Edge extension (content-script isolated world) vs. the
// web embed on a first-party page. In the extension, `localStorage` belongs to
// whatever host page you summoned Byte-ling on — an untrusted origin — so we must
// NOT persist the access token there (the host page could read it and
// impersonate you). In the extension the token lives in isolated-world memory
// only; on the web embed (your own site) localStorage persistence is fine.
const IS_EXTENSION = typeof chrome !== 'undefined' && !!chrome?.runtime?.id;
// In the extension the NAME (not a secret) can still be remembered across reloads
// via chrome.storage.local — that's the EXTENSION's own storage, not the host
// page's, so it's safe even though the token stays memory-only.
const EXT_NAME_KEY = 'byteling_ext_name';
const EXT_NAME_PIN_KEY = 'byteling_ext_name_pin';
const hasExtStorage = IS_EXTENSION && typeof chrome !== 'undefined' && !!chrome?.storage?.local;

function readToken() {
  if (IS_EXTENSION) return null; // never rehydrate a token from host-page storage
  try { return localStorage.getItem(TOKEN_KEY) || null; } catch { return null; }
}
function persistToken(token) {
  if (IS_EXTENSION) return; // keep it in memory only — never in the host page
  try { localStorage.setItem(TOKEN_KEY, token); } catch { /* ignore */ }
}
function forgetToken() {
  if (IS_EXTENSION) return;
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}
// The name isn't a secret, but mirror the token's storage rule so we don't drop
// the user's name into an untrusted host page's storage in the extension.
// readName is the SYNC initial value. In the extension it starts empty and the
// real value is hydrated async from chrome.storage.local (see the mount effect).
function readName() {
  if (IS_EXTENSION) return '';
  try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; }
}
function persistName(n, pinned) {
  if (IS_EXTENSION) {
    // chrome.storage.local = the extension's own storage (not the host page's),
    // so remembering the non-secret name here is safe and survives reload.
    if (hasExtStorage) {
      try { chrome.storage.local.set({ [EXT_NAME_KEY]: n, ...(pinned ? { [EXT_NAME_PIN_KEY]: true } : {}) }); } catch { /* ignore */ }
    }
    return;
  }
  try { localStorage.setItem(NAME_KEY, n); if (pinned) localStorage.setItem(NAME_KEY + '_pin', '1'); } catch { /* ignore */ }
}
function readNamePinned() {
  if (IS_EXTENSION) return false; // hydrated async alongside the name
  try { return localStorage.getItem(NAME_KEY + '_pin') === '1'; } catch { return false; }
}
function forgetName() {
  if (IS_EXTENSION) {
    if (hasExtStorage) { try { chrome.storage.local.remove([EXT_NAME_KEY, EXT_NAME_PIN_KEY]); } catch { /* ignore */ } }
    return;
  }
  try { localStorage.removeItem(NAME_KEY); localStorage.removeItem(NAME_KEY + '_pin'); } catch { /* ignore */ }
}

// Ambient check-in lines — Byte opens up on his own when it's been quiet a
// while. Companion first: he's keeping you company, not angling for work. Keep
// them warm and idle — no pitching code, no "point me at a repo".
const NUDGES = [
  "How's it going over there?",
  'Still here — just keeping you company.',
  "Hope the day's treating you alright.",
  'No agenda. Just around if you want me.',
  'Quiet stretch. How are you doing?',
];
function pickNudge(name) {
  const withName = name
    ? [`How's it going, ${name}?`, `Still here with you, ${name}.`]
    : [];
  const all = [...withName, ...NUDGES];
  return all[Math.floor(Math.random() * all.length)];
}
const IDLE_MS = 5 * 60 * 1000; // quiet for this long → Byte checks in once

// Ambient "poke": now and then, right after you click something, the flame
// drifts over to it and drops a light remark — a reaction, not a delayed twitch.
// Fully LOCAL — the label never leaves the browser — credential-blind, label only.
const POKE_DELAY = 450;         // ms after the click → reads as a reaction, not a lag
const POKE_COOLDOWN = 90 * 1000; // at most one poke per ~1.5 min
const POKE_CHANCE = 0.25;        // …and only ~1 in 4 eligible clicks, so it stays a surprise
const POKES = [
  (l) => `Saw you tap "${l}".`,
  (l) => `"${l}", hm.`,
  (l) => `Noticed you over by "${l}".`,
  (l) => `"${l}" — I'm around if you want me.`,
];
function pokeComment(label) {
  return POKES[Math.floor(Math.random() * POKES.length)](label);
}
function readPos() {
  try {
    const p = JSON.parse(localStorage.getItem(POS_KEY));
    return p && typeof p.left === 'number' && typeof p.top === 'number' ? p : null;
  } catch { return null; }
}
function readSize(fallback) {
  const n = Number((() => { try { return localStorage.getItem(SIZE_KEY); } catch { return null; } })());
  return n >= DOCK_MIN && n <= DOCK_MAX ? n : fallback;
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Read an image File/Blob into a data URL for the vision call.
function readImageFile(file) {
  return new Promise((resolve) => {
    if (!file || !/^image\//.test(file.type)) return resolve(null);
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

// Cross-origin call to a Byteling backend function (CORS is open). Throws an
// Error carrying { status, code } on non-2xx so callers can branch on auth /
// no-key / no-connection.
async function callFn(name, body, token) {
  const res = await fetch(`${BYTELING_BASE}/functions/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-App-Id': BYTELING_APP_ID
    },
    body: JSON.stringify(body || {})
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.code = data.code;
    throw err;
  }
  return data;
}

const MAX_TREE_LINES = 1000;

// Only scan the host page when the user is actually asking to be shown where
// something is — never in the background.
const LOCATE_RE = /\b(where('?s| is| are)?|show me|point (me )?(to|at)|take me to|jump to|highlight|find( me)? the|locate|which (button|tab|link|menu|control|option|setting|one))\b/i;
// Dead zones: never scan password/secret controls. Same selectors the app uses.
const HOST_SENSITIVE_SEL = 'input[type="password"], [autocomplete*="password"], [autocomplete*="cc-"], [data-sensitive]';

/**
 * Scan the HOST page's visible, interactive controls so Byte-ling can point the
 * flame at the one the user asked about. Runs in the embed's context, so
 * `document` is the host page (the embed's own UI is inside a shadow root and is
 * invisible to this query). Credential-blind: skips password/secret fields, and
 * only ever collects control LABELS + positions — never values a user typed.
 * Returns [{ id, label, el }] (el kept locally to fly the flame; only id+label
 * are sent to the backend).
 */
function scanHostUi() {
  const out = [];
  const seen = new Set();
  const els = document.querySelectorAll(
    'button, a[href], [role="button"], [role="link"], [role="tab"], [role="menuitem"], summary, input[type="submit"], input[type="button"]'
  );
  for (const el of els) {
    if (out.length >= 40) break;
    if (el.matches(HOST_SENSITIVE_SEL) || el.closest(HOST_SENSITIVE_SEL)) continue; // dead zone
    const r = el.getBoundingClientRect();
    if (r.width < 6 || r.height < 6) continue; // not visible
    if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) continue; // off-screen
    const label = (el.getAttribute('aria-label') || el.textContent || el.value || el.getAttribute('title') || '')
      .replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push({ id: 'host-' + out.length, label, el });
  }
  return out;
}

function EmbedApp({ hue, dockSize: initialDockSize }) {
  const [open, setOpen] = useState(false);
  const [dockSize, setDockSize] = useState(() => readSize(initialDockSize));
  const [pos, setPos] = useState(readPos);       // null = default bottom-right
  const [unlocked, setUnlocked] = useState(false);
  const rootRef = useRef(null);
  const dragRef = useRef({ moved: false });
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [image, setImage] = useState(null); // attached screenshot (data URL) for vision
  const [sending, setSending] = useState(false);
  const [pulse, setPulse] = useState(null);
  const [token, setToken] = useState(readToken);
  const [name, setName] = useState(readName);
  const [repos, setRepos] = useState(null); // null = not loaded yet
  const [repo, setRepo] = useState(null);    // { full_name, tree_text }
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [repoError, setRepoError] = useState(null);
  const [flameHidden, setFlameHidden] = useState(false); // idle flame steps out for a video flourish
  const idRef = useRef(0);
  const scrollRef = useRef(null);
  const dockRef = useRef(null);  // the docked lantern — where the flame launches from
  const flyRef = useRef(null);   // FlyingFlame handle: flyRef.current.flyTo(hostEl)
  const flourishRef = useRef(null); // imperative: fire the spren flourish on cue
  const lastActivityRef = useRef(Date.now()); // for the ambient check-in timer
  const nudgedRef = useRef(false);
  const namePinnedRef = useRef(readNamePinned()); // true once the user states their name
  const lastPokeAtRef = useRef(0); // when the flame last poked, for the cooldown

  // Extension: hydrate the remembered name from chrome.storage.local (async; the
  // extension's own storage, so it survives reload even though the token doesn't).
  useEffect(() => {
    if (!hasExtStorage) return;
    try {
      chrome.storage.local.get([EXT_NAME_KEY, EXT_NAME_PIN_KEY], (r) => {
        if (r && typeof r[EXT_NAME_KEY] === 'string' && r[EXT_NAME_KEY]) {
          setName(r[EXT_NAME_KEY]);
          if (r[EXT_NAME_PIN_KEY]) namePinnedRef.current = true;
        }
      });
    } catch { /* ignore */ }
  }, []);

  const fire = (kind) => setPulse({ id: ++idRef.current, kind });
  // Reset the idle clock on any real interaction so Byte only checks in when
  // things have genuinely gone quiet.
  const bump = () => { lastActivityRef.current = Date.now(); nudgedRef.current = false; };
  const mood = sending ? 'thinking' : 'resting';

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  // Fire the spren flourish on cue from the host page — window.bytelingFlourish()
  // — so it can be triggered on demand for a demo (it's otherwise rare) or to
  // calibrate placement against the real dock.
  useEffect(() => {
    const trigger = () => flourishRef.current?.play?.();
    try { window.bytelingFlourish = trigger; } catch { /* ignore */ }
    return () => { try { if (window.bytelingFlourish === trigger) delete window.bytelingFlourish; } catch { /* ignore */ } };
  }, []);

  // Receive the access token from the sign-in popup (posted to our origin).
  useEffect(() => {
    const onMsg = (e) => {
      if (e.origin !== BYTELING_BASE) return;
      if (e.data && e.data.type === 'byteling-auth' && e.data.token) {
        setToken(e.data.token);
        persistToken(e.data.token);
        if (typeof e.data.name === 'string' && e.data.name) {
          if (!namePinnedRef.current) { // a name the user stated wins over the login name
            setName(e.data.name);
            persistName(e.data.name, false);
          }
        }
        bump();
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // Ambient check-in: when the user's been signed in but quiet for a while,
  // Byte opens up on his own with a friendly line — once per quiet stretch,
  // never into a backgrounded tab.
  useEffect(() => {
    if (!token) return;
    bump();
    const iv = setInterval(() => {
      if (nudgedRef.current) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (Date.now() - lastActivityRef.current < IDLE_MS) return;
      nudgedRef.current = true;
      setMessages((m) => [...m, { role: 'assistant', text: pickNudge(name) }]);
      setOpen(true);
      fire('drift');
    }, 30000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, name]);

  // Ambient poke: right after you click a host-page control, the flame *sometimes*
  // drifts over to it and drops a light remark — a prompt reaction (POKE_DELAY),
  // not a delayed twitch. Kept a surprise with a cooldown + chance, never during a
  // chat (panel open) or a backgrounded tab. Entirely local: label only, never
  // values, credential-blind. A click also counts as activity (resets idle).
  useEffect(() => {
    if (!token) return;
    const onClick = (e) => {
      const el = e.target?.closest?.('button, a[href], [role="button"], [role="link"], [role="tab"], [role="menuitem"], summary');
      if (!el) return;
      if (el.matches(HOST_SENSITIVE_SEL) || el.closest(HOST_SENSITIVE_SEL)) return; // dead zone
      const label = (el.getAttribute('aria-label') || el.textContent || el.value || el.getAttribute('title') || '')
        .replace(/\s+/g, ' ').trim().slice(0, 48);
      if (!label) return;
      bump();

      // …and now and then, notice it — promptly, so it reads as a reaction.
      const now = Date.now();
      if (open) return;                                     // not mid-conversation
      if (now - lastPokeAtRef.current < POKE_COOLDOWN) return;
      if (Math.random() > POKE_CHANCE) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      lastPokeAtRef.current = now;
      setTimeout(() => {
        if (!el.isConnected) return;                        // clicked, then it went away
        const r = el.getBoundingClientRect();
        if (!r.width || r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) return;
        flyRef.current?.flyTo(el, { hold: 1100 });
        setMessages((m) => [...m, { role: 'assistant', text: pokeComment(label) }]);
        fire('drift');
      }, POKE_DELAY);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [token, open]);

  const clearToken = () => {
    setToken(null);
    forgetToken();
    setName('');
    forgetName();
  };

  // Sign out: drop the token and wipe the session-local state so the next
  // person on this browser doesn't inherit the thread or repo.
  const signOut = () => {
    clearToken();
    setMessages([]);
    setRepo(null);
    setRepos(null);
    setPickerOpen(false);
    setMenuOpen(false);
    setRepoError(null);
  };

  // Enter "move & resize" mode: close the panel and let the bare lantern be
  // dragged / resized, persisting position + size.
  const enterUnlock = () => { setUnlocked(true); setOpen(false); setMenuOpen(false); };
  const exitUnlock = () => setUnlocked(false);

  const resize = (next) => {
    const n = clamp(Math.round(next), DOCK_MIN, DOCK_MAX);
    setDockSize(n);
    try { localStorage.setItem(SIZE_KEY, String(n)); } catch { /* ignore */ }
  };

  // Drag the whole dock (lantern + flame move as one) while unlocked.
  const onDockPointerDown = (e) => {
    if (!unlocked) return;
    e.preventDefault();
    const root = rootRef.current;
    const rect = root.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY;
    dragRef.current = { moved: false };
    const move = (ev) => {
      dragRef.current.moved = true;
      const left = clamp(rect.left + (ev.clientX - startX), 4, window.innerWidth - rect.width - 4);
      const top = clamp(rect.top + (ev.clientY - startY), 4, window.innerHeight - rect.height - 4);
      setPos({ left, top });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (dragRef.current.moved) {
        const r = rootRef.current.getBoundingClientRect();
        try { localStorage.setItem(POS_KEY, JSON.stringify({ left: r.left, top: r.top })); } catch { /* ignore */ }
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const signIn = () => {
    bump();
    const url = `${BYTELING_BASE}/embed-auth?opener=${encodeURIComponent(window.location.origin)}`;
    window.open(url, 'byteling-auth', 'width=460,height=680,menubar=no,toolbar=no');
    if (!open) setOpen(true);
  };

  // Lazy-load the user's repos the first time the panel opens while signed in.
  useEffect(() => {
    if (!open || !token || repos !== null) return;
    setRepoError(null);
    callFn('github-repo', { action: 'list' }, token)
      .then((d) => setRepos(d.repos || []))
      .catch((e) => {
        setRepos([]);
        setRepoError(e.status === 409 ? 'Connect GitHub in Byte-ling to open a repo.' : (e.message || 'Could not load repos.'));
      });
  }, [open, token, repos]);

  const openRepo = async (fullName) => {
    setPickerOpen(false);
    setRepoError(null);
    try {
      const d = await callFn('github-repo', { action: 'tree', repo_full_name: fullName }, token);
      const paths = (d.tree || []).filter((e) => e.type === 'blob').map((e) => e.path).slice(0, MAX_TREE_LINES);
      setRepo({ full_name: fullName, tree_text: paths.join('\n') });
      fire('drift');
    } catch (e) {
      setRepoError(e.message || 'Could not open that repo.');
    }
  };

  const patch = (idx, p) => setMessages((m) => m.map((x, i) => (i === idx ? { ...x, ...p } : x)));

  const confirmPr = async (idx, proposal) => {
    // Write narrow: open the PR against the target Byte named (or the user's
    // override on the card), not just whatever repo is open.
    const target = messages[idx]?.writeRepo || proposal?.repo_full_name || repo?.full_name;
    if (!target) return;
    patch(idx, { prPending: true });
    try {
      const d = await callFn('github-pr', { repo_full_name: target, ...proposal }, token);
      // Clear the proposal's buttons, then have Byte reply with the PR link so
      // it reads as "here's your PR" rather than a card silently appearing.
      setMessages((m) => [
        ...m.map((x, i) => (i === idx ? { ...x, prPending: false, proposal: null } : x)),
        { role: 'assistant', text: "Done — the PR's up.", prResult: d },
      ]);
      fire('spark');
    } catch (e) {
      patch(idx, { prPending: false, prError: e.message || 'Could not open the PR.' });
    }
  };

  // "Let Byte see my screen" — one downscaled frame attached to the next turn.
  const captureScreen = async () => {
    // Extension: one click grabs the visible tab via the background worker
    // (activeTab grant, no getDisplayMedia picker that a page's policy can block).
    if (IS_EXTENSION && chrome?.runtime?.sendMessage) {
      try {
        const res = await chrome.runtime.sendMessage({ type: 'byteling-capture-tab' });
        if (res?.ok && res.dataUrl) {
          setImage(res.dataUrl);
          if (!open) setOpen(true);
        } else {
          setMessages((m) => [...m, { role: 'assistant', text: "Couldn't capture this tab — some pages (the store, browser settings) block it. Attach a screenshot instead.", error: true }]);
        }
      } catch {
        setMessages((m) => [...m, { role: 'assistant', text: "Couldn't capture this tab — attach a screenshot instead.", error: true }]);
      }
      return;
    }
    // Web embed: the browser's screen-share permission picker. The user chooses
    // what to share; we grab one downscaled frame.
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setMessages((m) => [...m, { role: 'assistant', text: "Screen capture isn't available here — paste or attach a screenshot instead.", error: true }]);
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    } catch (e) {
      if (e?.name !== 'NotAllowedError' && e?.name !== 'AbortError') {
        setMessages((m) => [...m, { role: 'assistant', text: 'Could not start screen capture.', error: true }]);
      }
      return; // user cancelled the picker
    }
    try {
      const video = document.createElement('video');
      video.srcObject = stream;
      await video.play();
      await new Promise((r) => setTimeout(r, 250));
      const maxW = 1600;
      const vw = video.videoWidth || maxW;
      const vh = video.videoHeight || 900;
      const scale = Math.min(1, maxW / vw);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vw * scale);
      canvas.height = Math.round(vh * scale);
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      setImage(canvas.toDataURL('image/jpeg', 0.85));
      if (!open) setOpen(true);
    } catch {
      setMessages((m) => [...m, { role: 'assistant', text: 'Could not capture the screen.', error: true }]);
    } finally {
      stream.getTracks().forEach((t) => t.stop());
    }
  };

  const submit = async () => {
    const text = input.trim();
    if ((!text && !image) || sending) return;

    // "Do a flourish" — perform on command, client-side (instant, and works even
    // signed out, so it's a safe demo trigger).
    if (!image && isFlourishRequest(text)) {
      bump();
      setInput('');
      setMessages((m) => [...m, { role: 'user', text }, { role: 'assistant', text: flourishLine() }]);
      flourishRef.current?.play?.();
      return;
    }

    if (!token) { signIn(); return; }
    bump();

    // If they tell Byte their name, remember it (over the login name) and pin it.
    const stated = extractName(text);
    if (stated) { setName(stated); namePinnedRef.current = true; persistName(stated, true); }
    const effectiveName = stated || name;

    // The embed keeps its own thread and replays it as history (no session_id).
    const history = messages.filter((m) => !m.error).map((m) => ({ role: m.role, text: m.text }));
    const shot = image; // the attached screenshot, sent once with this turn
    setInput('');
    setImage(null);
    setMessages((m) => [...m, { role: 'user', text: text || 'What do you see here?', image: shot }]);
    setSending(true);
    fire('notice');

    // "Where is X?" → scan the host page's controls so Byte can point the flame
    // at one. Only on a locate-type ask; credential-blind; labels only. The
    // element handles stay local (hostMap); only {id,label} go to the backend.
    let hostMap = null;
    let uiElements;
    if (LOCATE_RE.test(text)) {
      const scan = scanHostUi();
      if (scan.length) {
        hostMap = new Map(scan.map((s) => [s.id, s.el]));
        uiElements = scan.map((s) => ({ id: s.id, label: s.label }));
      }
    }

    try {
      const data = await callFn('claude-chat', {
        message: text,
        history,
        repo_full_name: repo?.full_name,
        context: repo ? { tree_text: repo.tree_text } : undefined,
        // Give Byte the openable-repo list so he can open one by name himself
        // ("look at my emberweave repo") instead of only via the picker.
        repos: (repos || []).map((r) => ({ full_name: r.full_name, description: r.description })),
        ui_elements: uiElements,
        image: shot, // a screenshot for Byte to actually see
        user_name: effectiveName || undefined // so he greets/refers by their real name
      }, token);
      setSending(false);
      fire('spark');
      if (data.reply || data.pr_proposal) {
        setMessages((m) => [...m, { role: 'assistant', text: data.reply || '', proposal: data.pr_proposal || null }]);
      }
      if (data.open_repo) openRepo(data.open_repo);
      // Byte pointed at a host-page control — send the flame across to it.
      if (data.point_at && hostMap) {
        const el = hostMap.get(data.point_at);
        if (el) setTimeout(() => flyRef.current?.flyTo(el), 200);
      }
    } catch (e) {
      setSending(false);
      if (e.status === 401) clearToken();
      const msg = e.status === 401
        ? 'Your session expired — sign in again.'
        : (e.code === 'no_provider_key' || e.code === 'invalid_provider_key')
          ? 'Add your Anthropic key in Byte-ling first, then come back.'
          : (e.message || 'Something went wrong.');
      setMessages((m) => [...m, { role: 'assistant', text: msg, error: true }]);
    }
  };

  const rootStyle = pos ? { left: `${pos.left}px`, top: `${pos.top}px`, right: 'auto', bottom: 'auto' } : undefined;

  return (
    <div ref={rootRef} className={`btlc-root ${unlocked ? 'btlc-unlocked' : ''}`} style={rootStyle}>
      <div className={`btlc-panel ${open ? 'btlc-open' : ''}`} role="dialog" aria-label="Byte-ling"
        onDragOver={token ? (e) => { e.preventDefault(); } : undefined}
        onDrop={token ? async (e) => {
          const file = e.dataTransfer?.files?.[0];
          if (file && /^image\//.test(file.type)) { e.preventDefault(); const url = await readImageFile(file); if (url) { setImage(url); if (!open) setOpen(true); } }
        } : undefined}>
        <div className="btlc-head">
          <span className="btlc-head-title">
            <FlameMark hue={hue ?? 42} /> Byte-ling
            {token && (
              <button className="btlc-repo" onClick={() => setPickerOpen((o) => !o)} title="Pick a repository">
                <span className="btlc-repo-ico">⎇</span>
                {repo ? repo.full_name.split('/').pop() : 'pick a repo'}
              </button>
            )}
          </span>
          <span className="btlc-head-actions">
            {token && (
              <button className="btlc-gear" onClick={() => setMenuOpen((o) => !o)} title="Settings" aria-label="Settings">⚙</button>
            )}
            <button className="btlc-x" onClick={() => setOpen(false)} aria-label="Close">×</button>
          </span>
        </div>

        {menuOpen && token && (
          <div className="btlc-menu">
            <button className="btlc-menu-item" onClick={enterUnlock}>Move &amp; resize</button>
            <a className="btlc-menu-item" href={BYTELING_BASE} target="_blank" rel="noreferrer" onClick={() => setMenuOpen(false)}>
              Open Byte-ling ↗
            </a>
            <button className="btlc-menu-item btlc-menu-danger" onClick={signOut}>Sign out</button>
          </div>
        )}

        {pickerOpen && token && (
          <div className="btlc-picker">
            {repos === null ? (
              <div className="btlc-picker-note">loading…</div>
            ) : repoError ? (
              <div className="btlc-picker-note">{repoError}</div>
            ) : repos.length === 0 ? (
              <div className="btlc-picker-note">No repositories found.</div>
            ) : (
              repos.map((r) => (
                <button key={r.full_name} className="btlc-picker-item" onClick={() => openRepo(r.full_name)}>
                  {r.full_name}
                </button>
              ))
            )}
          </div>
        )}

        <div className="btlc-body" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="btlc-aside">
              <FlameMark hue={hue ?? 42} />
              {token
                ? ` Welcome back${name ? ', ' + name : ''}. Good to see you — what's on your mind? (I can dig into your code whenever you want.)`
                : ' Sign in with your Byte-ling account to chat with your own Anthropic key.'}
            </div>
          )}
          {messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="btlc-row btlc-right">
                <div className="btlc-bubble btlc-user">
                  {m.image && <img className="btlc-shot" src={m.image} alt="attached screenshot" />}
                  {m.text}
                </div>
              </div>
            ) : (
              <div key={i} className="btlc-row">
                <span className="btlc-ava"><FlameMark hue={hue ?? 42} /></span>
                <div className="btlc-botcol">
                  {m.text && <div className={`btlc-bubble btlc-bot ${m.error ? 'btlc-err' : ''}`}>{m.text}</div>}
                  {m.prResult && (
                    <a className="btlc-prlink" href={m.prResult.pr_url} target="_blank" rel="noreferrer">
                      Opened PR #{m.prResult.number} ↗
                    </a>
                  )}
                  {m.proposal && !m.prResult && (() => {
                    // Write narrow: name the target repo and let the user pick it
                    // before the PR opens. Default = the repo Byte read the change
                    // from (or the open repo); flag a cross-repo write.
                    const repoList = repos || [];
                    const target = m.writeRepo || m.proposal.repo_full_name || repo?.full_name || '';
                    const crossRepo = target && repo?.full_name && target !== repo.full_name;
                    return (
                    <div className="btlc-prcard">
                      <div className="btlc-prtitle">{m.proposal.title}</div>
                      <div className="btlc-prfiles">
                        {m.proposal.changes.length} file{m.proposal.changes.length > 1 ? 's' : ''}: {m.proposal.changes.map((c) => c.path).join(', ')}
                      </div>
                      <div className="btlc-prtarget">
                        <span>Opens a PR in</span>
                        {repoList.length > 1 ? (
                          <select value={target} onChange={(e) => patch(i, { writeRepo: e.target.value })}>
                            {repoList.map((r) => (
                              <option key={r.full_name} value={r.full_name}>{r.full_name}</option>
                            ))}
                          </select>
                        ) : (
                          <strong>{target || '—'}</strong>
                        )}
                      </div>
                      {crossRepo && (
                        <div className="btlc-prwarn">Different repo than the one open ({repo.full_name}).</div>
                      )}
                      {m.prError && <div className="btlc-prerr">{m.prError}</div>}
                      <div className="btlc-prbtns">
                        <button className="btlc-prbtn" disabled={m.prPending || !target} onClick={() => confirmPr(i, m.proposal)}>
                          {m.prPending ? 'Opening…' : 'Open PR'}
                        </button>
                        <button className="btlc-prghost" onClick={() => patch(i, { proposal: null })}>Dismiss</button>
                      </div>
                    </div>
                    );
                  })()}
                </div>
              </div>
            )
          )}
          {sending && (
            <div className="btlc-row">
              <span className="btlc-ava"><FlameMark hue={hue ?? 42} /></span>
              <div className="btlc-bubble btlc-bot btlc-typing"><span></span><span></span><span></span></div>
            </div>
          )}
        </div>

        {token && image && (
          <div className="btlc-shotchip">
            <img src={image} alt="attached screenshot" />
            <span>Screenshot attached</span>
            <button onClick={() => setImage(null)} aria-label="Remove screenshot">×</button>
          </div>
        )}
        <div className="btlc-composer">
          {token ? (
            <>
              <label className="btlc-attach" title="Attach a screenshot for Byte-ling to see">
                <img alt="" src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48'/></svg>" />
                <input type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={async (e) => { const url = await readImageFile(e.target.files?.[0]); if (url) setImage(url); e.target.value = ''; }} />
              </label>
              <button type="button" className="btlc-attach" title={IS_EXTENSION ? 'Let Byte-ling see this tab — one click' : 'Let Byte-ling see your screen — you pick what to share'} onClick={captureScreen}>
                <img alt="" src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><rect x='2' y='3' width='20' height='14' rx='2'/><path d='M8 21h8M12 17v-4'/></svg>" />
              </button>
              <textarea
                className="btlc-input"
                rows={1}
                placeholder={image ? 'Ask about this screenshot…' : (repo ? `Ask about ${repo.full_name.split('/').pop()}…` : 'Ask Byte-ling…')}
                value={input}
                onChange={(e) => { setInput(e.target.value); bump(); }}
                onPaste={async (e) => {
                  const item = [...(e.clipboardData?.items || [])].find((it) => it.type.startsWith('image/'));
                  if (item) { e.preventDefault(); const url = await readImageFile(item.getAsFile()); if (url) setImage(url); }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
                }}
              />
              <button className="btlc-send" onClick={submit} disabled={(!input.trim() && !image) || sending} aria-label="Send">↑</button>
            </>
          ) : (
            <button className="btlc-signin" onClick={signIn}>Sign in to chat</button>
          )}
        </div>
      </div>

      {unlocked && (
        <div className="btlc-resizebar">
          <span className="btlc-resize-label">Size</span>
          <input
            className="btlc-resize-range"
            type="range"
            min={DOCK_MIN}
            max={DOCK_MAX}
            value={dockSize}
            onChange={(e) => resize(Number(e.target.value))}
          />
          <button className="btlc-resize-done" onClick={exitUnlock}>Done</button>
        </div>
      )}

      <button
        ref={dockRef}
        className="btlc-dock"
        style={{ width: dockSize, cursor: unlocked ? 'grab' : 'pointer', touchAction: unlocked ? 'none' : 'auto' }}
        onPointerDown={onDockPointerDown}
        onClick={() => { if (!unlocked) setOpen((o) => !o); }}
        aria-label={unlocked ? 'Drag to move Byte-ling' : (open ? 'Close Byte-ling' : 'Open Byte-ling')}
        title={unlocked ? 'Drag to move · use the slider to resize' : 'Byte-ling'}
      >
        <Lantern mood={mood} pulse={pulse} hue={hue} size={dockSize} flameHidden={flameHidden} />
      </button>

      {/* The flame can leave the lantern to point at controls on the host page.
          The comet clip is served from the Byte-ling origin (not inlined into
          embed.js); FlyingFlame falls back to the still flame if it 404s. */}
      <FlyingFlame ref={flyRef} hue={hue ?? 200} homeRef={dockRef} comet={`${BYTELING_BASE}/flame-comet.mp4`} />

      {/* Rare spren flourish — flame leaves the lantern as leaves and returns as
          a ribbon. Clips served from the Byte-ling origin (same as the comet). */}
      <LanternFlourish
        ref={flourishRef}
        anchorRef={dockRef}
        outClip={`${BYTELING_BASE}/flame-to-leaves.mp4`}
        inClip={`${BYTELING_BASE}/ribbon-to-flame.mp4`}
        onActiveChange={setFlameHidden}
      />

      <EmbedStyles />
    </div>
  );
}

function EmbedStyles() {
  return (
    <style>{`
      .btlc-root {
        position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;
        font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
        display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
      }
      .btlc-dock {
        border: 0; background: transparent; padding: 0; cursor: pointer;
        line-height: 0; filter: drop-shadow(0 6px 14px rgba(0,0,0,.35));
        transition: transform .18s ease;
      }
      .btlc-dock:hover { transform: translateY(-2px) scale(1.03); }

      .btlc-panel {
        width: 340px; max-width: calc(100vw - 40px);
        height: 460px; max-height: calc(100vh - 120px);
        background: #17171b; color: #e9e9ee;
        border: 1px solid #2a2a31; border-radius: 16px; overflow: hidden;
        display: flex; flex-direction: column;
        box-shadow: 0 18px 50px rgba(0,0,0,.5);
        transform-origin: bottom right;
        opacity: 0; transform: translateY(12px) scale(.96);
        pointer-events: none;
        transition: opacity ${OPEN_MS}ms ease, transform ${OPEN_MS}ms cubic-bezier(.2,.8,.2,1);
      }
      .btlc-panel.btlc-open { opacity: 1; transform: translateY(0) scale(1); pointer-events: auto; }
      .btlc-panel { position: relative; }

      .btlc-head {
        display: flex; align-items: center; justify-content: space-between;
        padding: 12px 14px; border-bottom: 1px solid #24242b;
      }
      .btlc-head-title { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; font-size: 15px; min-width: 0; }

      .btlc-repo {
        display: inline-flex; align-items: center; gap: 4px; max-width: 130px;
        border: 0; cursor: pointer; font: inherit; font-size: 11.5px; font-weight: 600;
        background: rgba(255,255,255,.06); color: #b9b9c2;
        padding: 3px 8px; border-radius: 7px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .btlc-repo:hover { background: rgba(255,255,255,.11); color: #e9e9ee; }
      .btlc-repo-ico { opacity: .7; }

      .btlc-picker {
        position: absolute; top: 47px; left: 10px; right: 10px; z-index: 5;
        max-height: 240px; overflow-y: auto;
        background: #1d1d23; border: 1px solid #33333c; border-radius: 10px;
        box-shadow: 0 12px 30px rgba(0,0,0,.5); padding: 4px;
      }
      .btlc-picker-note { padding: 10px 12px; font-size: 12.5px; color: #a7a7b0; }
      .btlc-picker-item {
        display: block; width: 100%; text-align: left; border: 0; cursor: pointer;
        background: transparent; color: #d7d7de; font: inherit; font-size: 12.5px;
        padding: 7px 9px; border-radius: 7px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .btlc-picker-item:hover { background: rgba(255,255,255,.07); }

      .btlc-botcol { display: flex; flex-direction: column; gap: 6px; max-width: 82%; }
      .btlc-prcard { border: 1px solid #3a3a44; background: rgba(255,255,255,.03); border-radius: 12px; padding: 10px; }
      .btlc-prtitle { font-size: 12.5px; font-weight: 600; color: #e9e9ee; }
      .btlc-prfiles { font-size: 11px; color: #9a9aa4; margin-top: 2px; word-break: break-all; }
      .btlc-prtarget { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 11px; color: #9a9aa4; margin-top: 7px; }
      .btlc-prtarget strong { color: #e9e9ee; font-weight: 600; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      .btlc-prtarget select { max-width: 60%; font: inherit; font-size: 11px; color: #e9e9ee; background: rgba(255,255,255,.04); border: 1px solid #3a3a44; border-radius: 6px; padding: 2px 4px; }
      .btlc-prwarn { font-size: 11px; color: #f0b45a; margin-top: 5px; }
      .btlc-prerr { font-size: 11px; color: #ffb4b4; margin-top: 6px; }
      .btlc-prbtns { display: flex; gap: 6px; margin-top: 8px; }
      .btlc-prbtn { border: 0; cursor: pointer; font: inherit; font-size: 12px; font-weight: 700; background: #e9e9ee; color: #17171b; padding: 5px 12px; border-radius: 8px; }
      .btlc-prbtn:disabled { opacity: .5; cursor: default; }
      .btlc-prghost { border: 0; cursor: pointer; font: inherit; font-size: 12px; background: transparent; color: #9a9aa4; padding: 5px 8px; border-radius: 8px; }
      .btlc-prghost:hover { color: #e9e9ee; }
      .btlc-prlink { display: inline-block; font-size: 12.5px; color: #8fb7ff; text-decoration: none; border: 1px solid #33333c; border-radius: 8px; padding: 6px 10px; }
      .btlc-prlink:hover { background: rgba(255,255,255,.05); }
      .btlc-x { border: 0; background: transparent; color: #8a8a94; font-size: 20px; cursor: pointer; line-height: 1; padding: 0 4px; }
      .btlc-x:hover { color: #e9e9ee; }

      .btlc-body { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
      .btlc-aside {
        align-self: center; text-align: center; max-width: 90%;
        font-size: 12.5px; color: #a7a7b0; line-height: 1.5;
        display: inline-flex; align-items: center; gap: 6px;
        background: rgba(255,255,255,.03); border: 1px solid #262630;
        padding: 8px 12px; border-radius: 999px;
      }
      .btlc-row { display: flex; gap: 8px; align-items: flex-start; }
      .btlc-right { justify-content: flex-end; }
      .btlc-ava { width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; font-size: 15px; margin-top: 2px; flex: 0 0 auto; }
      .btlc-bubble { max-width: 82%; padding: 8px 12px; border-radius: 14px; font-size: 13.5px; line-height: 1.5; white-space: pre-wrap; }
      .btlc-user { background: #e9e9ee; color: #17171b; border-bottom-right-radius: 5px; }
      .btlc-bot { background: #232329; color: #e9e9ee; border-bottom-left-radius: 5px; }

      .btlc-typing { display: inline-flex; gap: 4px; align-items: center; }
      .btlc-typing span { width: 6px; height: 6px; border-radius: 50%; background: #7d7d88; display: inline-block; animation: btlc-blink 1.2s infinite; }
      .btlc-typing span:nth-child(2) { animation-delay: .2s; }
      .btlc-typing span:nth-child(3) { animation-delay: .4s; }
      @keyframes btlc-blink { 0%,80%,100% { opacity: .3; } 40% { opacity: 1; } }

      .btlc-composer { display: flex; gap: 8px; padding: 10px; border-top: 1px solid #24242b; align-items: flex-end; }
      .btlc-attach { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border: 0; background: transparent; padding: 0; border-radius: 8px; cursor: pointer; opacity: .8; }
      .btlc-attach:hover { opacity: 1; background: rgba(255,255,255,.06); }
      .btlc-attach img { width: 16px; height: 16px; display: block; }
      .btlc-shotchip { display: flex; align-items: center; gap: 8px; margin: 0 10px; padding: 6px 8px; background: rgba(255,255,255,.05); border: 1px solid #24242b; border-radius: 8px; font-size: 12px; color: #a9a9b2; }
      .btlc-shotchip img { width: 28px; height: 28px; object-fit: cover; border-radius: 5px; }
      .btlc-shotchip span { flex: 1; }
      .btlc-shotchip button { border: 0; background: transparent; color: #a9a9b2; cursor: pointer; font-size: 16px; line-height: 1; padding: 0 2px; }
      .btlc-shot { display: block; max-width: 100%; border-radius: 8px; margin-bottom: 6px; }
      .btlc-input {
        flex: 1; resize: none; max-height: 96px; background: #101014; color: #e9e9ee;
        border: 1px solid #2c2c34; border-radius: 10px; padding: 9px 11px; font: inherit; font-size: 13.5px;
        outline: none;
      }
      .btlc-input:focus { border-color: #3a3a44; }
      .btlc-input::placeholder { color: #6b6b74; }
      .btlc-send {
        flex: 0 0 auto; width: 36px; height: 36px; border-radius: 10px; border: 0; cursor: pointer;
        background: #e9e9ee; color: #17171b; font-size: 16px; font-weight: 700;
      }
      .btlc-send:disabled { opacity: .4; cursor: default; }
      .btlc-err { background: rgba(220,70,70,.14); color: #ffb4b4; }
      .btlc-signin {
        flex: 1; height: 38px; border-radius: 10px; border: 0; cursor: pointer;
        background: #e9e9ee; color: #17171b; font: inherit; font-size: 13.5px; font-weight: 700;
      }
      .btlc-signin:hover { filter: brightness(.95); }

      .btlc-head-actions { display: inline-flex; align-items: center; gap: 2px; flex: 0 0 auto; }
      .btlc-gear { border: 0; background: transparent; color: #8a8a94; font-size: 15px; cursor: pointer; line-height: 1; padding: 0 5px; }
      .btlc-gear:hover { color: #e9e9ee; }
      .btlc-menu {
        position: absolute; top: 47px; right: 10px; z-index: 6; min-width: 156px;
        background: #1d1d23; border: 1px solid #33333c; border-radius: 10px;
        box-shadow: 0 12px 30px rgba(0,0,0,.5); padding: 4px;
      }
      .btlc-menu-item {
        display: block; width: 100%; text-align: left; border: 0; cursor: pointer; text-decoration: none;
        background: transparent; color: #d7d7de; font: inherit; font-size: 12.5px; padding: 8px 10px; border-radius: 7px;
      }
      .btlc-menu-item:hover { background: rgba(255,255,255,.07); }
      .btlc-menu-danger { color: #ff9d9d; }

      .btlc-unlocked .btlc-dock { outline: 2px dashed rgba(201,162,75,.75); outline-offset: 5px; border-radius: 14px; }
      .btlc-resizebar {
        display: flex; align-items: center; gap: 8px; padding: 7px 11px;
        background: #1d1d23; color: #d7d7de; border: 1px solid #33333c; border-radius: 12px;
        box-shadow: 0 10px 26px rgba(0,0,0,.45);
      }
      .btlc-resize-label { font-size: 11px; color: #a7a7b0; }
      .btlc-resize-range { width: 120px; accent-color: hsl(42 92% 60%); }
      .btlc-resize-done { border: 0; cursor: pointer; font: inherit; font-size: 12px; font-weight: 700; background: #e9e9ee; color: #17171b; padding: 4px 11px; border-radius: 8px; }

      @media (prefers-color-scheme: light) {
        .btlc-panel { background: #ffffff; color: #17171b; border-color: #e6e6ea; }
        .btlc-head { border-color: #eee; }
        .btlc-bot { background: #f1f1f4; color: #17171b; }
        .btlc-user { background: #17171b; color: #fff; }
        .btlc-input { background: #f6f6f8; color: #17171b; border-color: #e0e0e6; }
        .btlc-composer, .btlc-body .btlc-aside { border-color: #eee; }
        .btlc-send, .btlc-signin, .btlc-resize-done { background: #17171b; color: #fff; }
        .btlc-err { background: rgba(200,40,40,.1); color: #b22; }
        .btlc-picker, .btlc-menu, .btlc-resizebar { background: #fff; border-color: #e6e6ea; color: #17171b; box-shadow: 0 12px 30px rgba(0,0,0,.15); }
        .btlc-picker-item, .btlc-menu-item { color: #333; }
        .btlc-picker-item:hover, .btlc-menu-item:hover { background: #f2f2f5; }
        .btlc-repo { background: rgba(0,0,0,.05); color: #555; }
        .btlc-prcard { border-color: #e6e6ea; background: #fafafb; }
        .btlc-prtitle { color: #17171b; }
        .btlc-prtarget strong { color: #17171b; }
        .btlc-prtarget select { color: #17171b; background: #fff; border-color: #d4d4dc; }
        .btlc-prwarn { color: #b7791f; }
      }
      @media (max-width: 420px) {
        .btlc-root { right: 12px; bottom: 12px; }
      }
    `}</style>
  );
}

// On a phone-sized viewport the docked flame overlays the host app's touch
// targets and hurts the experience, so we don't mount there for now. Opt back in
// per-embed with mobile="show" / data-mobile="show" once mobile layout is handled.
function isMobileViewport() {
  try { return window.matchMedia('(max-width: 768px)').matches; } catch { return false; }
}

// Attach a shadow root to `host`, mount React inside it, and return the root.
// Shared by the custom element and the registry-free path below.
function renderCompanionInto(host, { hue = null, dockSize = 72, allowMobile = false } = {}) {
  if (!allowMobile && isMobileViewport()) return null; // skip on mobile
  const shadow = host.attachShadow({ mode: 'open' });
  const mount = document.createElement('div');
  shadow.appendChild(mount);
  const root = createRoot(mount);
  root.render(<EmbedApp hue={hue} dockSize={dockSize} />);
  return root;
}

class BytelingCompanion extends HTMLElement {
  connectedCallback() {
    const hueAttr = this.getAttribute('hue');
    const hue = hueAttr != null && hueAttr !== '' ? Number(hueAttr) : null;
    const dockSize = Number(this.getAttribute('size')) || 72;
    const allowMobile = this.getAttribute('mobile') === 'show';
    this._root = renderCompanionInto(this, { hue, dockSize, allowMobile });
  }

  disconnectedCallback() {
    this._root?.unmount();
    this._root = null;
  }
}

// customElements is a real registry on normal pages, but is `null` in an
// extension content-script isolated world (Chromium disables Custom Elements
// there). Guard for null so we don't throw, and fall back to a registry-free
// mount below when it's unavailable.
const CE = typeof customElements !== 'undefined' && customElements ? customElements : null;
if (CE && !CE.get('byteling-companion')) {
  CE.define('byteling-companion', BytelingCompanion);
}

// One-line install: if the page just includes the script (no <byteling-companion>
// tag of its own), auto-add the companion so it appears. Config can ride on the
// script tag as data-hue / data-size. Devs who place the tag themselves opt out.
const ROOT_ATTR = 'data-byteling-root';
function autoMount() {
  if (typeof document === 'undefined') return;
  // Already present (either the custom-element tag or our registry-free host).
  if (document.querySelector('byteling-companion') || document.querySelector(`[${ROOT_ATTR}]`)) return;

  const ds = (SELF_SCRIPT && SELF_SCRIPT.dataset) || {};
  const allowMobile = ds.mobile === 'show';
  // Don't even add the element on mobile (unless opted in) — it would just render
  // nothing, and this avoids a stray empty node in the host page.
  if (!allowMobile && isMobileViewport()) return;
  if (CE) {
    const el = document.createElement('byteling-companion');
    if (ds.hue) el.setAttribute('hue', ds.hue);
    if (ds.size) el.setAttribute('size', ds.size);
    if (allowMobile) el.setAttribute('mobile', 'show');
    document.body.appendChild(el);
  } else {
    // No custom-element registry (extension isolated world): mount straight
    // onto a plain host div with its own shadow root. Same UI, no registry.
    const host = document.createElement('div');
    host.setAttribute(ROOT_ATTR, '');
    document.body.appendChild(host);
    const hue = ds.hue != null && ds.hue !== '' ? Number(ds.hue) : null;
    const dockSize = Number(ds.size) || 72;
    renderCompanionInto(host, { hue, dockSize, allowMobile });
  }
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoMount);
  else autoMount();
}

export { BytelingCompanion };
