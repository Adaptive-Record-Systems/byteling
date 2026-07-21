import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import {
  getConnection, getProviderKey, getRepoTree, getRepoFiles,
  ensureSession, loadMessages, sendChat, errInfo
} from '@/api/byteling';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import {
  Sparkles, Github, KeyRound, Loader2, Send, FileCode, Plus, X, FolderGit2, AlertTriangle
} from 'lucide-react';

const LAST_REPO_KEY = 'byteling_last_repo';
const MAX_TREE_LINES = 1200; // cap the tree we send as context

// Minimal markdown styling (no typography plugin in this project).
const md = {
  p: (p) => <p className="mb-2 last:mb-0 leading-relaxed" {...p} />,
  ul: (p) => <ul className="list-disc pl-5 mb-2 space-y-1" {...p} />,
  ol: (p) => <ol className="list-decimal pl-5 mb-2 space-y-1" {...p} />,
  a: (p) => <a className="text-primary underline" target="_blank" rel="noreferrer" {...p} />,
  code: ({ inline, ...p }) =>
    inline
      ? <code className="px-1 py-0.5 rounded bg-muted font-mono text-[0.85em]" {...p} />
      : <code className="font-mono text-[0.85em]" {...p} />,
  pre: (p) => <pre className="mb-2 p-3 rounded-md bg-muted overflow-x-auto text-sm" {...p} />
};

export default function Chat() {
  const [ready, setReady] = useState(null); // null=loading, {connection, key} or {missing:[...]}
  const [repoInput, setRepoInput] = useState(localStorage.getItem(LAST_REPO_KEY) || '');
  const [repo, setRepo] = useState(null); // { full_name, tree, session }
  const [loadingRepo, setLoadingRepo] = useState(false);
  const [repoError, setRepoError] = useState(null);

  const [contextFiles, setContextFiles] = useState([]); // [{path, content, size}]
  const [pickerOpen, setPickerOpen] = useState(false);

  const [messages, setMessages] = useState([]); // [{role, text}]
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState(null);

  const scrollRef = useRef(null);

  // Guard: need both a GitHub connection and an Anthropic key.
  useEffect(() => {
    (async () => {
      try {
        const [connection, key] = await Promise.all([getConnection(), getProviderKey()]);
        const missing = [];
        if (!connection) missing.push('github');
        if (!key || key.status !== 'active') missing.push('key');
        setReady(missing.length ? { missing } : { connection, key });
      } catch {
        setReady({ missing: ['github', 'key'] });
      }
    })();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  const blobPaths = useMemo(
    () => (repo?.tree?.tree || []).filter((e) => e.type === 'blob').map((e) => e.path),
    [repo]
  );

  const loadRepo = async () => {
    const full = repoInput.trim();
    if (!full || !ready?.connection) return;
    setLoadingRepo(true);
    setRepoError(null);
    try {
      const tree = await getRepoTree(full);
      const session = await ensureSession(full, ready.connection.id);
      const prior = await loadMessages(session.id);
      setRepo({ full_name: full, tree, session });
      setContextFiles([]);
      setMessages(prior.map((m) => ({ role: m.role, text: m.text || '' })));
      localStorage.setItem(LAST_REPO_KEY, full);
    } catch (e) {
      const { message } = errInfo(e);
      setRepoError(
        message.includes('403')
          ? `${message}. If this is an org repo, an org owner must approve the Byteling OAuth app.`
          : message
      );
      setRepo(null);
    } finally {
      setLoadingRepo(false);
    }
  };

  const addContextFile = async (path) => {
    setPickerOpen(false);
    if (contextFiles.some((f) => f.path === path)) return;
    try {
      const files = await getRepoFiles(repo.full_name, [path]);
      const f = files[0];
      if (f?.ok) {
        setContextFiles((prev) => [...prev, { path, content: f.content, size: f.size }]);
      } else {
        setChatError(`Couldn't add ${path}: ${f?.error || 'unknown error'}`);
      }
    } catch (e) {
      setChatError(errInfo(e).message);
    }
  };

  const removeContextFile = (path) =>
    setContextFiles((prev) => prev.filter((f) => f.path !== path));

  const buildContext = () => {
    const paths = blobPaths.slice(0, MAX_TREE_LINES);
    const tree_text =
      paths.join('\n') + (blobPaths.length > MAX_TREE_LINES ? `\n… (${blobPaths.length - MAX_TREE_LINES} more)` : '');
    return {
      tree_text,
      files: contextFiles.map((f) => ({ path: f.path, content: f.content }))
    };
  };

  const send = async () => {
    const text = input.trim();
    if (!text || !repo || sending) return;
    setChatError(null);
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', text }]);
    setSending(true);
    try {
      const res = await sendChat({
        sessionId: repo.session.id,
        message: text,
        repoFullName: repo.full_name,
        context: buildContext()
      });
      setMessages((prev) => [...prev, { role: 'assistant', text: res.reply }]);
    } catch (e) {
      const { message, code } = errInfo(e);
      setChatError(
        code === 'no_provider_key' || code === 'invalid_provider_key'
          ? 'Your Anthropic key needs attention — set it on the home page.'
          : message
      );
    } finally {
      setSending(false);
    }
  };

  // --- Guard states ---
  if (ready === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (ready.missing) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-2xl mx-auto px-6 py-16 space-y-4">
          <h1 className="text-2xl font-heading font-bold">Almost there</h1>
          <p className="text-muted-foreground">Byteling needs two things before you can chat:</p>
          <ul className="space-y-2">
            <li className="flex items-center gap-2 text-sm">
              <Github className="w-4 h-4" />
              {ready.missing.includes('github') ? 'Connect your GitHub account' : 'GitHub connected ✓'}
            </li>
            <li className="flex items-center gap-2 text-sm">
              <KeyRound className="w-4 h-4" />
              {ready.missing.includes('key') ? 'Add your Anthropic API key' : 'Anthropic key added ✓'}
            </li>
          </ul>
          <Button asChild>
            <Link to="/">Go to setup</Link>
          </Button>
        </div>
      </div>
    );
  }

  // --- Chat ---
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="w-full max-w-3xl mx-auto px-4 py-6 flex-1 flex flex-col min-h-0">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="w-6 h-6 text-foreground" />
          <h1 className="text-xl font-heading font-bold">Byteling</h1>
          <Link to="/" className="ml-auto text-sm text-muted-foreground hover:text-foreground">
            Setup
          </Link>
        </div>

        {/* Repo bar */}
        <div className="flex items-center gap-2 mb-3">
          <FolderGit2 className="w-4 h-4 text-muted-foreground shrink-0" />
          <Input
            placeholder="owner/repo"
            value={repoInput}
            onChange={(e) => setRepoInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadRepo()}
            className="h-9"
          />
          <Button size="sm" onClick={loadRepo} disabled={loadingRepo || !repoInput.trim()}>
            {loadingRepo ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Load'}
          </Button>
        </div>
        {repoError && (
          <div className="flex items-start gap-2 text-sm text-destructive mb-3">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{repoError}</span>
          </div>
        )}

        {repo && (
          <>
            {/* Context files */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="text-xs text-muted-foreground">
                {repo.full_name} · {repo.tree.count} files
              </span>
              {contextFiles.map((f) => (
                <Badge key={f.path} variant="secondary" className="gap-1 font-mono text-xs">
                  <FileCode className="w-3 h-3" />
                  {f.path.split('/').pop()}
                  <button onClick={() => removeContextFile(f.path)} className="ml-1 hover:text-destructive">
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-7 gap-1 text-xs">
                    <Plus className="w-3 h-3" /> Add file to context
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="p-0 w-[420px]" align="start">
                  <Command>
                    <CommandInput placeholder="Search files…" />
                    <CommandList>
                      <CommandEmpty>No files.</CommandEmpty>
                      <CommandGroup>
                        {blobPaths.map((p) => (
                          <CommandItem key={p} value={p} onSelect={() => addContextFile(p)} className="font-mono text-xs">
                            {p}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
              {messages.length === 0 && (
                <div className="text-sm text-muted-foreground py-8 text-center">
                  Ask about <span className="font-mono">{repo.full_name}</span> — its structure, a specific
                  file, or a bug. Add files above to give Byteling their contents.
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                  <div
                    className={
                      m.role === 'user'
                        ? 'max-w-[85%] rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-4 py-2 text-sm whitespace-pre-wrap'
                        : 'max-w-[85%] rounded-2xl rounded-bl-sm bg-muted text-foreground px-4 py-3 text-sm'
                    }
                  >
                    {m.role === 'user' ? m.text : <ReactMarkdown components={md}>{m.text}</ReactMarkdown>}
                  </div>
                </div>
              ))}
              {sending && (
                <div className="flex justify-start">
                  <div className="rounded-2xl rounded-bl-sm bg-muted px-4 py-3">
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  </div>
                </div>
              )}
            </div>

            {chatError && <p className="text-sm text-destructive mt-2">{chatError}</p>}

            {/* Composer */}
            <div className="mt-3 flex items-end gap-2">
              <Textarea
                placeholder={`Message Byteling about ${repo.full_name}…`}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={2}
                className="resize-none"
              />
              <Button onClick={send} disabled={sending || !input.trim()} className="h-auto py-2">
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
