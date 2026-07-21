import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Github, Activity, MessageSquare, Loader2, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function Home() {
  const [ping, setPing] = useState(null);
  const [pinging, setPinging] = useState(false);

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

  useEffect(() => {
    runPing();
  }, []);

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
            Waiting for your next step… sessions, messages, and your activity log are wired up.
            Connect a repo to start talking to your assistant.
          </p>
        </div>
      </div>
    </div>
  );
}