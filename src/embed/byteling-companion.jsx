import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Lantern } from '@/components/Lantern';

/**
 * <byteling-companion> — the embeddable Byteling lantern.
 *
 * Drop-in for ANY page (React, Vue, plain HTML, another Base44 app):
 *   <script src="https://byteling-baas-417f0fd8.base44.app/embed.js"></script>
 *   <byteling-companion></byteling-companion>
 *
 * v1 scope: the living lantern only (visual + reactions). Chat + sign-in
 * land in the next steps. Rendered inside a Shadow DOM so the host page's
 * CSS can't touch it and ours can't leak out. The lantern's styles are
 * inline (see Lantern.jsx), so they travel into the shadow root cleanly.
 *
 * Attributes:
 *   hue="210"   optional 0–360 flame tint (default: warm amber)
 *   size="128"  optional px width of the lantern (default 128)
 */

function EmbedApp({ hue, size }) {
  const [pulse, setPulse] = useState(null);
  const idRef = useRef(0);
  const cycle = useRef(0);
  // Until chat is wired, a click makes the lantern react — proof it's alive.
  const react = () => {
    const kinds = ['drift', 'notice', 'spark'];
    const kind = kinds[cycle.current++ % kinds.length];
    setPulse({ id: ++idRef.current, kind });
  };
  return (
    <div
      style={{ width: size, cursor: 'pointer', lineHeight: 0 }}
      onClick={react}
      role="button"
      aria-label="Byteling"
      title="Byteling"
    >
      <Lantern mood="resting" pulse={pulse} hue={hue} className="" />
    </div>
  );
}

class BytelingCompanion extends HTMLElement {
  connectedCallback() {
    const shadow = this.attachShadow({ mode: 'open' });
    const mount = document.createElement('div');
    mount.style.display = 'inline-block';
    shadow.appendChild(mount);

    const hueAttr = this.getAttribute('hue');
    const hue = hueAttr != null && hueAttr !== '' ? Number(hueAttr) : null;
    const size = Number(this.getAttribute('size')) || 128;

    this._root = createRoot(mount);
    this._root.render(<EmbedApp hue={hue} size={size} />);
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
