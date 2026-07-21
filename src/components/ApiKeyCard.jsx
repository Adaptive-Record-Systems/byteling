import React, { useEffect, useState } from 'react';
import { getProviderKey, setProviderKey, errInfo } from '@/api/byteling';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { KeyRound, CheckCircle2, Loader2, AlertTriangle } from 'lucide-react';

/**
 * Bring-your-own-key card. Shows the stored key's hint + status, or an input to
 * add/replace it. The raw key is never read back (field-locked); we only ever
 * see key_hint. onChange(key) lets the parent react to connect/disconnect.
 */
export default function ApiKeyCard({ onChange }) {
  const [providerKey, setProviderKeyState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const key = await getProviderKey();
      setProviderKeyState(key);
      onChange?.(key);
    } catch (e) {
      setError(errInfo(e).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    const key = value.trim();
    if (!key) return;
    setSaving(true);
    setError(null);
    try {
      await setProviderKey(key);
      setValue('');
      setEditing(false);
      await refresh();
    } catch (e) {
      setError(errInfo(e).message);
    } finally {
      setSaving(false);
    }
  };

  const connected = providerKey && providerKey.status === 'active';
  const invalid = providerKey && providerKey.status === 'invalid';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="w-5 h-5" />
          Anthropic API key
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> checking…
          </span>
        ) : connected && !editing ? (
          <>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm text-foreground">
                <CheckCircle2 className="w-4 h-4" />
                Key connected <span className="font-mono text-muted-foreground">{providerKey.key_hint}</span>
              </span>
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                Replace
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Your key is stored server-side and never shown again. Usage bills to your own Anthropic account.
            </p>
          </>
        ) : (
          <>
            {invalid && !editing && (
              <div className="flex items-start gap-2 text-sm text-destructive">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>Your saved key was rejected by Anthropic. Enter a new one.</span>
              </div>
            )}
            <p className="text-sm text-muted-foreground">
              Byteling uses your own Anthropic key. Paste it below — it&apos;s validated, stored
              server-side, and never displayed again. Get one at{' '}
              <span className="font-mono">console.anthropic.com</span>.
            </p>
            <Input
              type="password"
              autoComplete="off"
              placeholder="sk-ant-…"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save();
              }}
            />
            <div className="flex items-center gap-2">
              <Button onClick={save} disabled={saving || !value.trim()}>
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" /> validating…
                  </>
                ) : (
                  'Save key'
                )}
              </Button>
              {editing && (
                <Button variant="ghost" onClick={() => { setEditing(false); setValue(''); setError(null); }}>
                  Cancel
                </Button>
              )}
            </div>
          </>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
