import React, { useEffect, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import {
  Github, Activity, MessageSquare, Loader2, CheckCircle2,
  Link2, Unlink, AlertTriangle
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

// Decodes the ?github=<status> value the oauth callback appends when it
// bounces the browser back here. Keep these in sync with the status codes in
// base44/functions/github-oauth-callback/entry.ts.
const GITHUB_STATUS = {
  connected: { tone: 'success', text: 'GitHub connected.' },
  denied: { tone: 'error', text: 'GitHub authorization was cancelled.' },
  invalid: { tone: 'error', text: 'That authorization link was invalid or already used — try again.' },
  expired: { tone: 'error', text: 'That authorization link expired — try again.' },
  bad_scope: { tone: 'error', text: 'GitHub granted the wrong permissions. Try again and approve repo access.' },
  failed: { tone: 'error', text: "Couldn't complete GitHub authorization. Please try again." }
};

export default function Home() {
  const [ping, setPing] = useState(null);
  const [pinging, setPinging] = useState(false);

  const [connection, setConnection] = useState(null);
  const [loadingConnection, setLoadingConnection] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [banner, setBanner] = useState(null);
  const [error, setError] = useState(null);

  const runPing = async () => {
    setPinging(true);
    try {
      const res = await base44.functions.invoke('ping', {});
      setPing(res.data);
    } catch (e) {
      setPing({ status: 'error', error: e.message });
    } finally {
      setPinging(false);
    }
  };

  const loadConnection = useCallback(async () => {
    setLoadingConnection(true);
    try {
      // RLS scopes this to the current user's own connections. The access_token
      // field is field-level locked, so it never comes back here.
      const rows = await base44.entities.GitHubConnection.list('-created_date');
      const active = rows.find((r) => r.status === 'active') || null;
      setConnection(active);
    } catch (e) {
      setError(e.message || 'Could not load GitHub connection');
    } finally {
      setLoadingConnection(false);
    }
  }, []);

  useEffect(() => {
    runPing();
    loadConnection();

    // Surface and then strip the ?github= status the callback left behind, so a
    // reload doesn't re-show a stale banner.
    const params = new URLSearchParams(window.location.search);
    const status = params.get('github');
    if (status) {
      setBanner(GITHUB_STATUS[status] || { tone: 'error', text: 'Unknown GitHub status.' });
      params.delete('github');
      const qs = params.toString();
      window.history.replaceState({}, document.title, `${window.location.pathname}${qs ? `?${qs}` : ''}`);
    }
  }, [loadConnection]);

  const connectGithub = async () => {
    setConnecting(true);
    setError(null);
    try {
      const res = await base44.functions.invoke('github-oauth-start', { return_path: '/' });
      const url = res.data?.authorize_url;
      if (!url) throw new Error('No authorize URL returned');
      // Hand the browser to GitHub. The callback brings us back to '/'.
      window.location.href = url;
    } catch (e) {
      setError(e.message || 'Could not start GitHub authorization');
      setConnecting(false);
    }
  };

  const disconnectGithub = async () => {
    if (!connection) return;
    setError(null);
    try {
      await base44.entities.GitHubConnection.delete(connection.id);
      setConnection(null);
      setBanner({ tone: 'success', text: 'GitHub disconnected.' });
    } catch (e) {
      setError(e.message || 'Could not disconnect');
    }
  };

  const healthy = ping && ping.status === 'ok';

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <div className="flex items-center gap-3 mb-2">
          <Github className="w-8 h-8 text-foreground" />
          <h1 className="text-3xl font-heading font-bold text-foreground">Byteling</h1>
        </div>
        <p className="text-muted-foreground mb-8">
          Your persistent AI companion and code assistant for connected GitHub repos.
        </p>

        {banner && (
          <div
            role="status"
            className={`mb-6 flex items-start gap-2 rounded-lg p-3 text-sm ${
              banner.tone === 'success'
                ? 'bg-primary/10 text-foreground'
                : 'bg-destructive/10 text-destructive'
            }`}
          >
            {banner.tone === 'success'
              ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
              : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />}
            <span>{banner.text}</span>
          </div>
        )}

        {/* GitHub connection */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Github className="w-5 h-5" />
              GitHub connection
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {loadingConnection ? (
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" /> checking…
              </span>
            ) : connection ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm text-foreground">
                    <CheckCircle2 className="w-4 h-4" />
                    Connected as <span className="font-medium">@{connection.github_username}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">scope: {connection.scope}</span>
                </div>
                <Button variant="outline" onClick={disconnectGithub}>
                  <Unlink className="w-4 h-4 mr-2" />
                  Disconnect
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Connect your GitHub account so Byteling can read your repo. Access is
                  scoped to <code className="text-xs">repo</code> only.
                </p>
                <Button onClick={connectGithub} disabled={connecting}>
                  {connecting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Redirecting to GitHub…
                    </>
                  ) : (
                    <>
                      <Link2 className="w-4 h-4 mr-2" />
                      Connect GitHub
                    </>
                  )}
                </Button>
              </>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
          </CardContent>
        </Card>

        {/* Backend health */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="w-5 h-5" />
              Backend status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Connectivity check</span>
              {pinging ? (
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" /> checking…
                </span>
              ) : healthy ? (
                <span className="flex items-center gap-2 text-sm text-foreground">
                  <CheckCircle2 className="w-4 h-4" /> operational
                </span>
              ) : (
                <span className="text-sm text-destructive">unavailable</span>
              )}
            </div>
            {ping && (
              <pre className="text-xs bg-muted text-muted-foreground rounded-md p-3 overflow-auto">
                {JSON.stringify(ping, null, 2)}
              </pre>
            )}
            <Button variant="outline" onClick={runPing} disabled={pinging}>
              Re-check
            </Button>
          </CardContent>
        </Card>

        <div className="mt-6 flex items-start gap-3 text-sm text-muted-foreground">
          <MessageSquare className="w-5 h-5 mt-0.5 shrink-0" />
          <p>
            Once a repo is connected, this is where your assistant and activity log
            will live.
          </p>
        </div>
      </div>
    </div>
  );
}
