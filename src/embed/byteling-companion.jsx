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

function readToken() {
  try { return localStorage.getItem(TOKEN_KEY) || null; } catch { return null; }
}

function EmbedApp({ hue, dockSize }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [pulse, setPulse] = useState(null);
  const [token, setToken] = useState(readToken);
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

  const signIn = () => {
    const url = `${BYTELING_BASE}/embed-auth?opener=${encodeURIComponent(window.location.origin)}`;
    window.open(url, 'byteling-auth', 'width=460,height=680,menubar=no,toolbar=no');
    if (!open) setOpen(true);
  };

  const submit = async () => {
    const text = input.trim();
    if (!text || sending) return;
    if (!token) { signIn(); return; }

    setInput('');
    setMessages((m) => [...m, { role: 'user', text }]);
    setSending(true);
    fire('notice');
    try {
      // Cross-origin call to the Byteling backend (CORS is open); the token
      // authenticates the user, their own Anthropic key does the work.
      const res = await fetch(`${BYTELING_BASE}/functions/claude-chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-App-Id': BYTELING_APP_ID
        },
        body: JSON.stringify({ message: text })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          clearToken();
          throw new Error('Your session expired — sign in again.');
        }
        if (data.code === 'no_provider_key' || data.code === 'invalid_provider_key') {
          throw new Error('Add your Anthropic key in Byte-ling first, then come back.');
        }
        throw new Error(data.error || 'Something went wrong.');
      }
      setSending(false);
      fire('spark');
      setMessages((m) => [...m, { role: 'assistant', text: data.reply || '…' }]);
    } catch (e) {
      setSending(false);
      setMessages((m) => [...m, { role: 'assistant', text: e.message || 'Error', error: true }]);
    }
  };

  return (
    <div className="btlc-root">
      <div className={`btlc-panel ${open ? 'btlc-open' : ''}`} role="dialog" aria-label="Byte-ling">
        <div className="btlc-head">
          <span className="btlc-head-title">
            <FlameMark hue={hue ?? 42} /> Byte-ling
          </span>
          <button className="btlc-x" onClick={() => setOpen(false)} aria-label="Close">×</button>
        </div>

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
                <div className={`btlc-bubble btlc-bot ${m.error ? 'btlc-err' : ''}`}>{m.text}</div>
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
                placeholder="Ask Byte-ling…"
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

      <button
        className="btlc-dock"
        style={{ width: dockSize }}
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close Byte-ling' : 'Open Byte-ling'}
        title="Byte-ling"
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

      .btlc-head {
        display: flex; align-items: center; justify-content: space-between;
        padding: 12px 14px; border-bottom: 1px solid #24242b;
      }
      .btlc-head-title { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; font-size: 15px; }
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

      @media (prefers-color-scheme: light) {
        .btlc-panel { background: #ffffff; color: #17171b; border-color: #e6e6ea; }
        .btlc-head { border-color: #eee; }
        .btlc-bot { background: #f1f1f4; color: #17171b; }
        .btlc-user { background: #17171b; color: #fff; }
        .btlc-input { background: #f6f6f8; color: #17171b; border-color: #e0e0e6; }
        .btlc-composer, .btlc-body .btlc-aside { border-color: #eee; }
        .btlc-send, .btlc-signin { background: #17171b; color: #fff; }
        .btlc-err { background: rgba(200,40,40,.1); color: #b22; }
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
