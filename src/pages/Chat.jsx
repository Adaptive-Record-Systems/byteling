import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import {
  getConnection, listRepos, getRepoTree, getRepoFiles, ensureSession, loadMessages, sendChat, openPr, errInfo
} from '@/api/byteling';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import {
  Loader2, Send, FileCode, Plus, X, GitBranch, AlertTriangle, Settings, FolderGit2,
  GitPullRequest, ExternalLink, Puzzle
} from 'lucide-react';
import { Lantern, FlameMark, hueFromRepo } from '@/components/Lantern';
import { FlyingFlame } from '@/components/FlyingFlame';
import flameVideo from '@/assets/lantern/Flame_idle.mp4';
import cometVideo from '@/assets/lantern/flame-comet.mp4';

const LAST_REPO_KEY = 'byteling_last_repo';
const MAX_TREE_LINES = 1200;

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

function Aside({ children }) {
  return (
    <div className="self-center flex items-center gap-2 max-w-[90%] text-xs text-muted-foreground bg-primary/5 border border-primary/10 px-3 py-1.5 rounded-full">
      <FlameMark className="text-base shrink-0" />
      <span className="font-serif">{children}</span>
    </div>
  );
}

function ByteAvatar({ hue = 42 }) {
  return (
    <span className="w-6 h-6 rounded-md bg-primary/5 flex items-center justify-center shrink-0 mt-1">
      <FlameMark className="text-base" hue={hue} />
    </span>
  );
}

export default function Chat() {
  const [connection, setConnection] = useState(null);
  const [repos, setRepos] = useState([]);
  const [repo, setRepo] = useState(null);
  const [loadingRepo, setLoadingRepo] = useState(false);
  const [repoPickerOpen, setRepoPickerOpen] = useState(false);
  const [repoError, setRepoError] = useState(null);

  const [contextFiles, setContextFiles] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState(null);

  const scrollRef = useRef(null);
  const lanternWrapRef = useRef(null); // where the flame launches from / returns to
  const flameFlyRef = useRef(null);    // imperative handle: flameFlyRef.current.flyTo(el)
  // On-screen landmarks the flame can point at when the user asks "where is X?".
  const repoPillRef = useRef(null);
  const addFileRef = useRef(null);
  const setupRef = useRef(null);
  const composerRef = useRef(null);
  const sendRef = useRef(null);

  // ── Lantern character ──────────────────────────────────────────────
  // The flame reacts to real events (never a timer). `pulse` fires a one-shot
  // reaction; `mood` is the steady state; the flame is tinted by the open repo.
  const [pulse, setPulse] = useState(null);
  const [idle, setIdle] = useState(false);
  const pulseId = useRef(0);
  const firePulse = (kind) => setPulse({ id: (pulseId.current += 1), kind });
  const lanternHue = useMemo(() => hueFromRepo(repo?.full_name), [repo]);
  const lanternMood = sending || loadingRepo ? 'thinking' : idle ? 'dim' : 'resting';

  // Dim the flame once the user has been still for a while (deep in flow).
  useEffect(() => {
    setIdle(false);
    const t = setTimeout(() => setIdle(true), 45000);
    return () => clearTimeout(t);
  }, [messages, sending, loadingRepo, repo]);

  // On load, restore the last-open repo so the conversation survives a reload —
  // loadRepo pulls that repo's stored messages back in. The turns themselves are
  // already persisted server-side per session.
  useEffect(() => {
    getConnection().then((conn) => {
      setConnection(conn);
      const last = localStorage.getItem(LAST_REPO_KEY);
      if (conn && last) loadRepo(last, { conn });
    }).catch(() => {});
    listRepos().then(setRepos).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending, loadingRepo]);

  const blobPaths = useMemo(
    () => (repo?.tree?.tree || []).filter((e) => e.type === 'blob').map((e) => e.path),
    [repo]
  );

  // keepThread: keep the visible conversation (used when Byteling opens a repo
  // mid-chat); otherwise replace with that repo's own stored history.
  const loadRepo = async (fullName, { keepThread = false, conn = connection } = {}) => {
    const full = (fullName || '').trim();
    if (!full || !conn) return;
    setRepoPickerOpen(false);
    setLoadingRepo(true);
    setRepoError(null);
    try {
      const tree = await getRepoTree(full);
      const session = await ensureSession(full, conn.id);
      setRepo({ full_name: full, tree, session });
      setContextFiles([]);
      localStorage.setItem(LAST_REPO_KEY, full);
      firePulse('drift'); // flame reaches out to the newly opened repo
      // …and the living flame darts over to mark the repo it just opened.
      setTimeout(() => flameFlyRef.current?.flyTo(repoPillRef.current), 380);
      if (!keepThread) {
        const prior = await loadMessages(session.id);
        setMessages(prior.map((m) => ({ role: m.role, text: m.text || '' })));
      }
    } catch (e) {
      const { message } = errInfo(e);
      setRepoError(
        message.includes('403')
          ? `${message}. If this is an org repo, an org owner must approve the Byteling OAuth app.`
          : message
      );
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

  const patchMessage = (idx, patch) =>
    setMessages((prev) => prev.map((m, i) => (i === idx ? { ...m, ...patch } : m)));

  const confirmPr = async (idx) => {
    const m = messages[idx];
    if (!m?.proposal || !repo) return;
    patchMessage(idx, { prPending: true, prError: null });
    try {
      const res = await openPr({ repoFullName: repo.full_name, ...m.proposal });
      patchMessage(idx, { prResult: res, prPending: false, proposal: null });
      firePulse('spark'); // a PR landed — bright celebratory flare
    } catch (e) {
      patchMessage(idx, { prError: errInfo(e).message, prPending: false });
    }
  };

  // The app's own controls Byte-ling can point the flame at. Labels only — no
  // values, no sensitive fields (the API key lives on the Setup screen, not here).
  const uiLandmarks = [
    { id: 'repo-picker', label: 'Repo picker — choose which repository to open', ref: repoPillRef },
    { id: 'add-file', label: 'Add file to context button', ref: addFileRef },
    { id: 'setup', label: 'Setup / settings (GitHub connection and Anthropic API key)', ref: setupRef },
    { id: 'composer', label: 'Message box where you type to Byte-ling', ref: composerRef },
    { id: 'send', label: 'Send button', ref: sendRef },
  ];
  const collectUiElements = () =>
    uiLandmarks.filter((l) => l.ref.current).map((l) => ({ id: l.id, label: l.label }));
  const pointFlameAt = (id) => {
    const l = uiLandmarks.find((x) => x.id === id);
    if (l?.ref.current) flameFlyRef.current?.flyTo(l.ref.current);
  };

  const buildContext = () => {
    if (!repo) return undefined;
    const paths = blobPaths.slice(0, MAX_TREE_LINES);
    const tree_text = paths.join('\n') + (blobPaths.length > MAX_TREE_LINES ? `\n… (${blobPaths.length - MAX_TREE_LINES} more)` : '');
    return { tree_text, files: contextFiles.map((f) => ({ path: f.path, content: f.content })) };
  };

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setChatError(null);
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', text }]);
    setSending(true);
    try {
      // Ensure the repo list is loaded before we ask — if the mount fetch
      // hasn't landed yet, get it inline so "open my X app" always resolves.
      let repoList = repos;
      if (!repoList.length) {
        try {
          repoList = await listRepos();
          setRepos(repoList);
        } catch {
          repoList = [];
        }
      }
      const res = await sendChat({
        sessionId: repo?.session?.id,
        message: text,
        repoFullName: repo?.full_name,
        context: buildContext(),
        repos: repoList.map((r) => ({ full_name: r.full_name, description: r.description })),
        uiElements: collectUiElements()
      });
      if (res.reply || res.pr_proposal) {
        setMessages((prev) => [...prev, { role: 'assistant', text: res.reply || '', proposal: res.pr_proposal || null }]);
        if (res.pr_proposal) firePulse('notice'); // flame leans in — a fix is on the table
      }
      if (res.open_repo) await loadRepo(res.open_repo, { keepThread: true });
      // Byte-ling pointed at an on-screen control — send the flame to it.
      if (res.point_at) setTimeout(() => pointFlameAt(res.point_at), 250);
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

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* The lantern hangs from the top edge — a presence you forget is there
          until the moment you need the corner lit. It reacts to chat events. */}
      <div ref={lanternWrapRef} className="fixed top-0 right-4 sm:right-8 z-20 pointer-events-none">
        <Lantern mood={lanternMood} pulse={pulse} hue={lanternHue} flameVideo={flameVideo} />
      </div>

      {/* The flame can leave the lantern to point at things on screen. */}
      <FlyingFlame ref={flameFlyRef} hue={lanternHue ?? 200} homeRef={lanternWrapRef} comet={cometVideo} flame={flameVideo} />

      <div className="w-full max-w-3xl mx-auto px-4 py-4 flex-1 flex flex-col min-h-0">
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <span className="w-7 h-7 rounded-lg bg-primary/5 flex items-center justify-center text-lg">
            <FlameMark hue={lanternHue ?? 200} />
          </span>
          <h1 className="text-lg font-heading font-bold">Byte-ling</h1>

          <Popover open={repoPickerOpen} onOpenChange={setRepoPickerOpen}>
            <PopoverTrigger asChild>
              <button ref={repoPillRef} className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted hover:bg-muted/70 px-2.5 py-1 rounded-md">
                {loadingRepo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitBranch className="w-3.5 h-3.5" />}
                {repo ? repo.full_name : 'pick a repo'}
              </button>
            </PopoverTrigger>
            <PopoverContent className="p-0 w-[360px]" align="start">
              <Command>
                <CommandInput placeholder="Search your repos…" />
                <CommandList>
                  <CommandEmpty>No repos found.</CommandEmpty>
                  <CommandGroup>
                    {repos.map((r) => (
                      <CommandItem key={r.full_name} value={r.full_name} onSelect={() => loadRepo(r.full_name)} className="text-xs">
                        <FolderGit2 className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
                        {r.full_name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          <div className="ml-auto flex items-center gap-3">
            <a
              href="/install.html"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              title="Put Byte-ling on your own site or browser"
            >
              <Puzzle className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Add to your app</span>
            </a>
            <Link ref={setupRef} to="/?setup=1" className="text-muted-foreground hover:text-foreground" title="Setup">
              <Settings className="w-4 h-4" />
            </Link>
          </div>
        </div>

        {repoError && (
          <div className="flex items-start gap-2 text-sm text-destructive mb-3">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{repoError}</span>
          </div>
        )}

        {/* Context files (only with a repo loaded) */}
        {repo && (
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
                <Button ref={addFileRef} variant="outline" size="sm" className="h-7 gap-1 text-xs">
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
        )}

        {/* Thread */}
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1 flex flex-col">
          {messages.length === 0 && !repo && (
            <Aside>There you are. Tell me which repo to open — or just describe it, like &ldquo;check out my Nexus app.&rdquo;</Aside>
          )}
          {messages.length === 0 && repo && (
            <Aside>Got {repo.full_name} open. Ask me anything about it.</Aside>
          )}
          {messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-4 py-2 text-sm whitespace-pre-wrap">
                  {m.text}
                </div>
              </div>
            ) : (
              <div key={i} className="flex justify-start gap-2">
                <ByteAvatar hue={lanternHue ?? 200} />
                <div className="max-w-[85%] space-y-2">
                  {m.text && (
                    <div className="rounded-2xl rounded-bl-sm bg-muted text-foreground px-4 py-3 text-sm font-serif">
                      <ReactMarkdown components={md}>{m.text}</ReactMarkdown>
                    </div>
                  )}

                  {m.prResult && (
                    <a
                      href={m.prResult.pr_url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-foreground hover:bg-primary/10"
                    >
                      <GitPullRequest className="w-4 h-4 text-primary" />
                      Opened PR #{m.prResult.number}
                      <ExternalLink className="w-3.5 h-3.5 text-muted-foreground ml-auto" />
                    </a>
                  )}

                  {m.proposal && !m.prResult && (
                    <div className="rounded-lg border border-primary/20 bg-background/40 p-3">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <GitPullRequest className="w-4 h-4 text-primary" />
                        {m.proposal.title}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 font-mono">
                        {m.proposal.changes.length} file{m.proposal.changes.length > 1 ? 's' : ''}: {m.proposal.changes.map((c) => c.path).join(', ')}
                      </div>
                      {m.prError && <p className="text-xs text-destructive mt-2">{m.prError}</p>}
                      <div className="flex gap-2 mt-3">
                        <Button size="sm" onClick={() => confirmPr(i)} disabled={m.prPending}>
                          {m.prPending ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <>
                              <GitPullRequest className="w-4 h-4 mr-1.5" /> Open PR
                            </>
                          )}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => patchMessage(i, { proposal: null })}>
                          Dismiss
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          )}
          {(sending || loadingRepo) && (
            <div className="flex justify-start gap-2">
              <ByteAvatar hue={lanternHue ?? 200} />
              <div className="rounded-2xl rounded-bl-sm bg-muted px-4 py-3">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
        </div>

        {chatError && <p className="text-sm text-destructive mt-2">{chatError}</p>}

        {/* Composer — always available */}
        <div className="mt-3 flex items-end gap-2">
          <Textarea
            ref={composerRef}
            placeholder={repo ? `Ask about ${repo.full_name}…` : 'Ask Byte-ling to open a repo, or describe one…'}
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
          <Button ref={sendRef} onClick={send} disabled={sending || !input.trim()} className="h-auto py-2">
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
