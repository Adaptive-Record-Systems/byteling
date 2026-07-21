import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import {
  getConnection, getRepoTree, getRepoFiles, ensureSession, loadMessages, sendChat, errInfo
} from '@/api/byteling';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import {
  Sparkles, Loader2, Send, FileCode, Plus, X, GitBranch, AlertTriangle, Settings, FolderGit2
} from 'lucide-react';

const LAST_REPO_KEY = 'byteling_last_repo';
const MAX_TREE_LINES = 1200;

// Byteling's replies render in serif (a distinct "voice"); code stays mono.
const md = {
  p: (p) => <p className="mb-2 last:mb-0 leading-relaxed" {...p} />,
  ul: (p) => <ul className="list-disc pl-5 mb-2 space-y-1" {...p} />,
  ol: (p) => <ol className="list-decimal pl-5 mb-2 space-y-1" {...p} />,
  a: (p) => <a className="text-primary underline" target="_blank" rel="noreferrer" {...p} />,
  code: ({ inline, ...p }) =>
    inline
      ? <code className="px-1 py-0.5 rounded bg-background/60 font-mono text-[0.85em]" {...p} />
      : <code className="font-mono text-[0.85em]" {...p} />,
  pre: (p) => <pre className="mb-2 p-3 rounded-md bg-background/60 overflow-x-auto text-sm not-italic" {...p} />
};

// Companion "noticing" — a centered aside, distinct from a reply.
function Aside({ children }) {
  return (
    <div className="self-center flex items-center gap-2 max-w-[90%] text-xs text-muted-foreground bg-primary/5 border border-primary/10 px-3 py-1.5 rounded-full">
      <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
      <span className="font-serif">{children}</span>
    </div>
  );
}

export default function Chat() {
  const [connection, setConnection] = useState(null);
  const [repoInput, setRepoInput] = useState(localStorage.getItem(LAST_REPO_KEY) || '');
  const [repo, setRepo] = useState(null);
  const [editingRepo, setEditingRepo] = useState(false);
  const [loadingRepo, setLoadingRepo] = useState(false);
  const [repoError, setRepoError] = useState(null);

  const [contextFiles, setContextFiles] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState(null);

  const scrollRef = useRef(null);

  useEffect(() => {
    getConnection().then(setConnection).catch(() => {});
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
    if (!full || !connection) return;
    setLoadingRepo(true);
    setRepoError(null);
    try {
      const tree = await getRepoTree(full);
      const session = await ensureSession(full, connection.id);
      const prior = await loadMessages(session.id);
      setRepo({ full_name: full, tree, session });
      setContextFiles([]);
      setMessages(prior.map((m) => ({ role: m.role, text: m.text || '' })));
      setEditingRepo(false);
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
      if (f?.ok) setContextFiles((prev) => [...prev, { path, content: f.content }]);
      else setChatError(`Couldn't add ${path}: ${f?.error || 'unknown error'}`);
    } catch (e) {
      setChatError(errInfo(e).message);
    }
  };

  const removeContextFile = (path) => setContextFiles((prev) => prev.filter((f) => f.path !== path));

  const buildContext = () => {
    const paths = blobPaths.slice(0, MAX_TREE_LINES);
    const tree_text = paths.join('\n') + (blobPaths.length > MAX_TREE_LINES ? `\n… (${blobPaths.length - MAX_TREE_LINES} more)` : '');
    return { tree_text, files: contextFiles.map((f) => ({ path: f.path, content: f.content })) };
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
          ? 'Your Anthropic key needs attention — open Setup to fix it.'
          : message
      );
    } finally {
      setSending(false);
    }
  };

  const repoBar = (
    <div className="flex items-center gap-2">
      <FolderGit2 className="w-4 h-4 text-muted-foreground shrink-0" />
      <Input
        placeholder="owner/repo"
        value={repoInput}
        onChange={(e) => setRepoInput(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && loadRepo()}
        className="h-9"
        autoFocus
      />
      <Button size="sm" onClick={loadRepo} disabled={loadingRepo || !repoInput.trim()}>
        {loadingRepo ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Load'}
      </Button>
    </div>
  );

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="w-full max-w-3xl mx-auto px-4 py-4 flex-1 flex flex-col min-h-0">
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <span className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <Sparkles className="w-4 h-4" />
          </span>
          <h1 className="text-lg font-heading font-bold">Byteling</h1>
          {repo && !editingRepo && (
            <button
              onClick={() => setEditingRepo(true)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted hover:bg-muted/70 px-2.5 py-1 rounded-md"
            >
              <GitBranch className="w-3.5 h-3.5" />
              {repo.full_name}
            </button>
          )}
          <Link to="/?setup=1" className="ml-auto text-muted-foreground hover:text-foreground" title="Setup">
            <Settings className="w-4 h-4" />
          </Link>
        </div>

        {(editingRepo || !repo) && <div className="mb-3">{repoBar}</div>}
        {repoError && (
          <div className="flex items-start gap-2 text-sm text-destructive mb-3">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{repoError}</span>
          </div>
        )}

        {!repo ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
            <Sparkles className="w-8 h-8 text-primary/40 mb-3" />
            <p className="font-serif text-lg mb-1">Point me at a repo and I&apos;ll start reading.</p>
            <p className="text-sm text-muted-foreground">Type an <span className="font-mono">owner/repo</span> above — I&apos;ll pull its tree so you can ask me anything about it.</p>
          </div>
        ) : (
          <>
            {/* Context files */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="text-xs text-muted-foreground">{repo.tree.count} files</span>
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

            {/* Thread */}
            <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1 flex flex-col">
              {messages.length === 0 && (
                <Aside>There you are — I&apos;ve got {repo.full_name} open. Ask me anything about it.</Aside>
              )}
              {messages.map((m, i) => (
                <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start gap-2'}>
                  {m.role === 'assistant' && (
                    <span className="w-6 h-6 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-1">
                      <Sparkles className="w-3.5 h-3.5" />
                    </span>
                  )}
                  <div
                    className={
                      m.role === 'user'
                        ? 'max-w-[85%] rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-4 py-2 text-sm whitespace-pre-wrap'
                        : 'max-w-[85%] rounded-2xl rounded-bl-sm bg-muted text-foreground px-4 py-3 text-sm font-serif'
                    }
                  >
                    {m.role === 'user' ? m.text : <ReactMarkdown components={md}>{m.text}</ReactMarkdown>}
                  </div>
                </div>
              ))}
              {sending && (
                <div className="flex justify-start gap-2">
                  <span className="w-6 h-6 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-1">
                    <Sparkles className="w-3.5 h-3.5" />
                  </span>
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
                placeholder={`Ask about ${repo.full_name}…`}
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
