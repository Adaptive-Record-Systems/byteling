import React, { useEffect, useState } from 'react';
import { getConnection, startGithubConnect, disconnectGithub, errInfo } from '@/api/byteling';
import ApiKeyCard from '@/components/ApiKeyCard';
import { Button } from '@/components/ui/button';
import { Sparkles, Github, CheckCircle2, Loader2, Link2, ArrowRight, AlertTriangle, Puzzle } from 'lucide-react';

const GITHUB_STATUS = {
  connected: { tone: 'success', text: 'GitHub connected.' },
  denied: { tone: 'error', text: 'GitHub authorization was cancelled.' },
  invalid: { tone: 'error', text: 'That authorization link was invalid or already used — try again.' },
  expired: { tone: 'error', text: 'That authorization link expired — try again.' },
  bad_scope: { tone: 'error', text: 'GitHub granted the wrong permissions. Try again and approve repo access.' },
  failed: { tone: 'error', text: "Couldn't complete GitHub authorization. Please try again." }
};

/**
 * One-page, Byteling-led setup. Two steps light up; when both are ready the CTA
 * hands off to chat via onReady(). Rendered by the Landing router until the user
 * has both a GitHub connection and an active Anthropic key.
 */
export default function Onboarding({ onReady }) {
  const [connection, setConnection] = useState(null);
  const [loadingConn, setLoadingConn] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [providerKey, setProviderKey] = useState(null);
  const [banner, setBanner] = useState(null);
  const [error, setError] = useState(null);

  const loadConnection = async () => {
    setLoadingConn(true);
    try {
      setConnection(await getConnection());
    } catch (e) {
      setError(errInfo(e).message);
    } finally {
      setLoadingConn(false);
    }
  };

  useEffect(() => {
    loadConnection();
    const params = new URLSearchParams(window.location.search);
    const status = params.get('github');
    if (status) {
      setBanner(GITHUB_STATUS[status] || { tone: 'error', text: 'Unknown GitHub status.' });
      params.delete('github');
      const qs = params.toString();
      window.history.replaceState({}, document.title, `${window.location.pathname}${qs ? `?${qs}` : ''}`);
    }
  }, []);

  const connect = async () => {
    setConnecting(true);
    setError(null);
    try {
      const url = await startGithubConnect('/');
      window.location.href = url;
    } catch (e) {
      setError(errInfo(e).message);
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    if (!connection) return;
    try {
      await disconnectGithub(connection.id);
      setConnection(null);
    } catch (e) {
      setError(errInfo(e).message);
    }
  };

  const keyActive = providerKey && providerKey.status === 'active';
  const ready = connection && keyActive;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-xl mx-auto px-6 py-16">
        <div className="flex items-center gap-3 mb-2">
          <span className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <Sparkles className="w-5 h-5" />
          </span>
          <h1 className="text-2xl font-heading font-bold">Hi, I&apos;m Byte-ling.</h1>
        </div>
        <p className="text-muted-foreground mb-8 ml-12">
          I read your GitHub repo and help you understand it, spot fixes, and open PRs.
          Two quick things and we&apos;re in.
        </p>

        {banner && (
          <div
            role="status"
            className={`mb-6 flex items-start gap-2 rounded-lg p-3 text-sm ${
              banner.tone === 'success' ? 'bg-primary/10 text-foreground' : 'bg-destructive/10 text-destructive'
            }`}
          >
            {banner.tone === 'success'
              ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
              : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />}
            <span>{banner.text}</span>
          </div>
        )}

        {/* Step 1 — GitHub */}
        <div className={`rounded-xl border p-4 mb-3 ${connection ? 'border-border' : 'border-primary/40'}`}>
          <div className="flex items-center gap-3">
            <span className={connection ? 'text-foreground' : 'text-primary'}>
              {loadingConn ? <Loader2 className="w-5 h-5 animate-spin" /> : connection ? <CheckCircle2 className="w-5 h-5" /> : <Github className="w-5 h-5" />}
            </span>
            <div className="flex-1">
              <div className="text-sm font-medium">Connect GitHub</div>
              <div className="text-xs text-muted-foreground">so I can read your code · scoped to repo</div>
            </div>
            {connection ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">@{connection.github_username}</span>
                <Button variant="ghost" size="sm" onClick={disconnect}>Disconnect</Button>
              </div>
            ) : (
              <Button size="sm" onClick={connect} disabled={connecting}>
                {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Link2 className="w-4 h-4 mr-2" />Connect</>}
              </Button>
            )}
          </div>
        </div>

        {/* Step 2 — key */}
        <div className="mb-6">
          <ApiKeyCard onChange={setProviderKey} />
        </div>

        {/* Enter */}
        <Button className="w-full h-11" disabled={!ready} onClick={() => onReady?.()}>
          <ArrowRight className="w-4 h-4 mr-2" />
          Let&apos;s look at your code
        </Button>
        {!ready && (
          <p className="text-xs text-muted-foreground text-center mt-3">
            Finish both steps above to start.
          </p>
        )}

        {error && <p className="text-sm text-destructive mt-3">{error}</p>}

        {/* Distribution: how to put Byte-ling somewhere other than here. */}
        <div className="mt-10 pt-6 border-t border-border text-center">
          <a
            href="/install.html"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <Puzzle className="w-4 h-4" />
            Want Byte-ling in your own app or browser? See how
            <ArrowRight className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
}
