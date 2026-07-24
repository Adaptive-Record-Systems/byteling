import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Lantern, FlameMark } from '@/components/Lantern';

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
const POS_KEY = 'byteling_embed_pos';    // { left, top } once the user moves it
const SIZE_KEY = 'byteling_embed_size';  // dock px width once the user resizes it
const DOCK_MIN = 48;
const DOCK_MAX = 240;

function readToken() {
  try { return localStorage.getItem(TOKEN_KEY) || null; } catch { return null; }
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

function EmbedApp({ hue, dockSize: initialDockSize }) {
  const [open, setOpen] = useState(false);
  const [dockSize, setDockSize] = useState(() => readSize(initialDockSize));
  const [pos, setPos] = useState(readPos);       // null = default bottom-right
  const [unlocked, setUnlocked] = useState(false);
  const rootRef = useRef(null);
  const dragRef = useRef({ moved: false });
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [pulse, setPulse] = useState(null);
  const [token, setToken] = useState(readToken);
  const [repos, setRepos] = useState(null); // null = not loaded yet
  const [repo, setRepo] = useState(null);    // { full_name, tree_text }
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [repoError, setRepoError] = useState(null);
  const idRef = useRef(0);
  const scrollRef = useRef(null);

  const fire = (kind) => setPulse({ id: ++idRef.current, kind });
  const mood = sending ? 'thinking' : 'resting';

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  // Receive the access token from the sign-in popup (posted to our origin).
  useEffect(() => {
    const onMsg = (e) => {
      if (e.origin !== BYTELING_BASE) return;
      if (e.data && e.data.type === 'byteling-auth' && e.data.token) {
        setToken(e.data.token);
        try { localStorage.setItem(TOKEN_KEY, e.data.token); } catch { /* ignore */ }
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  const clearToken = () => {
    setToken(null);
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
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
    if (!repo) return;
    patch(idx, { prPending: true });
    try {
      const d = await callFn('github-pr', { repo_full_name: repo.full_name, ...proposal }, token);
      patch(idx, { prPending: false, prResult: d, proposal: null });
      fire('spark');
    } catch (e) {
      patch(idx, { prPending: false, prError: e.message || 'Could not open the PR.' });
    }
  };

  const submit = async () => {
    const text = input.trim();
    if (!text || sending) return;
    if (!token) { signIn(); return; }

    // The embed keeps its own thread and replays it as history (no session_id).
    const history = messages.filter((m) => !m.error).map((m) => ({ role: m.role, text: m.text }));
    setInput('');
    setMessages((m) => [...m, { role: 'user', text }]);
    setSending(true);
    fire('notice');
    try {
      const data = await callFn('claude-chat', {
        message: text,
        history,
        repo_full_name: repo?.full_name,
        context: repo ? { tree_text: repo.tree_text } : undefined
      }, token);
      setSending(false);
      fire('spark');
      if (data.reply || data.pr_proposal) {
        setMessages((m) => [...m, { role: 'assistant', text: data.reply || '', proposal: data.pr_proposal || null }]);
      }
      if (data.open_repo) openRepo(data.open_repo);
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
      <div className={`btlc-panel ${open ? 'btlc-open' : ''}`} role="dialog" aria-label="Byte-ling">
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
                ? ' There you are. Ask me anything — I read code, spot fixes, and open PRs.'
                : ' Sign in with your Byte-ling account to chat with your own Anthropic key.'}
            </div>
          )}
          {messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="btlc-row btlc-right">
                <div className="btlc-bubble btlc-user">{m.text}</div>
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
                  {m.proposal && !m.prResult && (
                    <div className="btlc-prcard">
                      <div className="btlc-prtitle">{m.proposal.title}</div>
                      <div className="btlc-prfiles">
                        {m.proposal.changes.length} file{m.proposal.changes.length > 1 ? 's' : ''}: {m.proposal.changes.map((c) => c.path).join(', ')}
                      </div>
                      {m.prError && <div className="btlc-prerr">{m.prError}</div>}
                      <div className="btlc-prbtns">
                        <button className="btlc-prbtn" disabled={m.prPending} onClick={() => confirmPr(i, m.proposal)}>
                          {m.prPending ? 'Opening…' : 'Open PR'}
                        </button>
                        <button className="btlc-prghost" onClick={() => patch(i, { proposal: null })}>Dismiss</button>
                      </div>
                    </div>
                  )}
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

        <div className="btlc-composer">
          {token ? (
            <>
              <textarea
                className="btlc-input"
                rows={1}
                placeholder={repo ? `Ask about ${repo.full_name.split('/').pop()}…` : 'Ask Byte-ling…'}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
                }}
              />
              <button className="btlc-send" onClick={submit} disabled={!input.trim() || sending} aria-label="Send">↑</button>
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
        className="btlc-dock"
        style={{ width: dockSize, cursor: unlocked ? 'grab' : 'pointer', touchAction: unlocked ? 'none' : 'auto' }}
        onPointerDown={onDockPointerDown}
        onClick={() => { if (!unlocked) setOpen((o) => !o); }}
        aria-label={unlocked ? 'Drag to move Byte-ling' : (open ? 'Close Byte-ling' : 'Open Byte-ling')}
        title={unlocked ? 'Drag to move · use the slider to resize' : 'Byte-ling'}
      >
        <Lantern mood={mood} pulse={pulse} hue={hue} size={dockSize} />
      </button>

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
      }
      @media (max-width: 420px) {
        .btlc-root { right: 12px; bottom: 12px; }
      }
    `}</style>
  );
}

class BytelingCompanion extends HTMLElement {
  connectedCallback() {
    const shadow = this.attachShadow({ mode: 'open' });
    const mount = document.createElement('div');
    shadow.appendChild(mount);

    const hueAttr = this.getAttribute('hue');
    const hue = hueAttr != null && hueAttr !== '' ? Number(hueAttr) : null;
    const dockSize = Number(this.getAttribute('size')) || 72;

    this._root = createRoot(mount);
    this._root.render(<EmbedApp hue={hue} dockSize={dockSize} />);
  }

  disconnectedCallback() {
    this._root?.unmount();
    this._root = null;
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('byteling-companion')) {
  customElements.define('byteling-companion', BytelingCompanion);
}

export { BytelingCompanion };
