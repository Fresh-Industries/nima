import { initialMeetingState } from "@t3tools/client-runtime/meetings";
import { useEffect, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  History,
  Maximize2,
  MessageSquare,
  Mic,
  MicOff,
  Settings,
  Square,
  Volume2,
  X,
} from "lucide-react";
import { BotId, ProjectId, type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Button } from "../../components/ui/button";
import { Switch } from "../../components/ui/switch";
import { isEditableFocused } from "../../lib/editableFocus";
import { Input } from "../../components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "../../components/ui/select";
import { SecretInput } from "../../components/settings/SecretInput";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
} from "../../components/ui/dialog";
import ChatMarkdown from "../../components/ChatMarkdown";
import { ChildThreadApprovals, ThreadApproval } from "../../components/chat/ChildThreadApprovals";
import { useEnvironments, useEnvironment, usePrimaryEnvironmentId } from "../../state/environments";
import { environmentThreadDetails } from "../../state/threads";
import { randomUUID } from "../../lib/utils";
import { useProjects } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { useBots } from "../useBots";
import ChatView from "../../components/ChatView";
import { BackgroundThreadContext } from "../../components/chat/backgroundThread";
import { ComposerHandleContext } from "../../composerHandleContext";
import { usePucko } from "./PuckoProvider";
import { PuckoFace } from "./PuckoFace";

const labels = {
  idle: "A little presence. A useful teammate.",
  listening: "Listening",
  summoned: "I'm listening",
  thinking: "Thinking",
  speaking: "Speaking",
  working: "Working with Bara",
  muted: "Microphone off",
  error: "Let's try that again",
};

const CHAT_KEY = "bara.pucko.chat";
function readChat() {
  try {
    return localStorage.getItem(CHAT_KEY) !== "0";
  } catch {
    return true;
  }
}
const SOLO_KEY = "bara.pucko.solo";
function readSolo() {
  try {
    return localStorage.getItem(SOLO_KEY) === "1";
  } catch {
    return false;
  }
}

export function PuckoApp() {
  const { host, start } = usePucko();
  const navigate = useNavigate();
  const [chat, setChatPreference] = useState(readChat);
  const setChat = (next: boolean) => {
    setChatPreference(next);
    try {
      localStorage.setItem(CHAT_KEY, next ? "1" : "0");
    } catch {
      // Only a per-viewer convenience.
    }
  };
  const [solo, setSoloPreference] = useState(readSolo);
  const setSolo = (next: boolean) => {
    setSoloPreference(next);
    host.controller?.setSolo(next);
    try {
      localStorage.setItem(SOLO_KEY, next ? "1" : "0");
    } catch {
      // Only a per-viewer convenience.
    }
  };
  const canTalk = host.state.phase === "listening" && !host.state.muted && !host.state.solo;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Space addresses Pucko without his name; a window key listener while a meeting listens
  useEffect(() => {
    if (!canTalk) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat || event.metaKey || event.ctrlKey || event.altKey)
        return;
      if (
        isEditableFocused(event.target) ||
        (event.target instanceof Element &&
          event.target.closest("button, a, input, select, [role=dialog], [role=menu]"))
      )
        return;
      event.preventDefault();
      host.controller?.talk();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canTalk, host.controller]);
  const primary = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const [chosen, setChosen] = useState<EnvironmentId | null>(null);
  const active = host.state.phase === "connecting" || host.state.phase === "listening";
  const environmentId = active ? host.environmentId : (chosen ?? primary);
  const environment = useEnvironment(environmentId);
  const supportsPucko = environment?.serverConfig?.environment.capabilities.pucko === true;
  const connected = environment?.connection.phase === "connected";
  const query = useEnvironmentQuery(
    environmentId && supportsPucko
      ? serverEnvironment.puckoLive({ environmentId, input: {} })
      : null,
  );
  const allowed = useAtomValue(serverEnvironment.meetingExperiment.permissionAtom(environmentId));
  const canConfigure = useAtomValue(serverEnvironment.configurePucko.permissionAtom(environmentId));
  const configure = useAtomCommand(serverEnvironment.configurePucko, { reportFailure: false });
  const command = useAtomCommand(serverEnvironment.meetingExperiment, { reportFailure: false });
  const [settings, setSettings] = useState(false),
    [history, setHistory] = useState(false),
    [consentDialog, setConsentDialog] = useState(false),
    [consent, setConsent] = useState(false);
  const [apiKey, setApiKey] = useState(""),
    [nameDraft, setNameDraft] = useState<string | null>(null),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const [projectId, setProjectId] = useState<ProjectId | null>(null),
    [botId, setBotId] = useState<BotId | null>(null),
    [selectedMeeting, setSelectedMeeting] = useState<string | null>(null);
  const configuration = query.data?.configuration;
  const homeThreadId = query.data?.homeThreadId;
  const openConversation = () =>
    homeThreadId && environmentId
      ? navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId, threadId: homeThreadId },
        })
      : undefined;
  const name = nameDraft ?? configuration?.activationName ?? "Citrus";
  const projects = useProjects();
  const team = useBots(environmentId ?? undefined);
  const meetings = query.data?.meetings ?? [];
  const selected = meetings.find((meeting) => meeting.id === selectedMeeting);
  const state = host.environmentId === environmentId ? host.state : initialMeetingState;
  const current = host.environmentId === environmentId ? state.result : null;
  const activation = current?.activationName ?? configuration?.activationName ?? "Citrus";
  const pending =
    current?.tasks.filter((task) => ["pending", "running", "waiting"].includes(task.status)) ?? [];
  const ready =
    connected && supportsPucko && configuration && configuration.keySource !== "missing" && allowed;
  const saveSettings = async (removeKey = false) => {
    if (!environmentId || !canConfigure || saving) return;
    setSaving(true);
    setError("");
    const result = await configure({
      environmentId,
      input: {
        activationName: name.trim(),
        ...(removeKey ? { apiKey: "" } : apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      },
    });
    setSaving(false);
    if (result._tag === "Success") {
      setApiKey("");
      setNameDraft(null);
      setSettings(false);
    } else {
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : "Could not save Pucko settings.");
    }
  };
  return (
    <main
      className="scrollbar-gutter-both relative flex min-h-0 flex-1 flex-col overflow-auto bg-background"
      aria-label="Pucko"
    >
      <header className="flex items-center justify-between gap-4 px-6 py-5 sm:px-10">
        <div>
          <h1 className="text-lg font-medium tracking-tight">Pucko</h1>
          <p className="mt-1 text-xs text-muted-foreground">Your meeting companion</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={chat ? "Hide chat" : "Show chat"}
            aria-pressed={chat}
            onClick={() => setChat(!chat)}
          >
            <MessageSquare size={17} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Meeting history"
            onClick={() => setHistory(!history)}
          >
            <History size={17} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Pucko settings"
            onClick={() => setSettings(true)}
          >
            <Settings size={17} />
          </Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 max-[900px]:flex-col">
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-8 pb-10 text-center">
          {canTalk ? (
            <button
              type="button"
              className="flex w-64 cursor-pointer items-center justify-center rounded-3xl outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:w-80"
              aria-label={`Talk to ${activation} without saying the name`}
              onClick={() => host.controller?.talk()}
            >
              <PuckoFace state={state.character} level={state.outputLevel} />
            </button>
          ) : (
            <div className="flex w-64 items-center justify-center sm:w-80">
              <PuckoFace state={state.character} level={state.outputLevel} />
            </div>
          )}
          <p role="status" className="min-h-6 text-sm text-muted-foreground">
            {state.phase === "connecting" ? state.stage : labels[state.character]}
          </p>
          <p className="mt-2 min-h-5 text-xs text-muted-foreground">
            {state.phase === "listening" && !state.muted
              ? state.solo
                ? "Just talk. I'm answering everything you say."
                : state.attentive
                  ? `Go ahead, no need to say “${activation}”.`
                  : `Say “${activation}” anywhere in your sentence, or tap me or press Space.`
              : (environment?.label ?? "Connect to Bara to begin")}
          </p>
          <div className="mt-8 flex min-h-11 items-center gap-3">
            {!active ? (
              <Button
                size="lg"
                disabled={!ready}
                onClick={() => {
                  setConsent(false);
                  setConsentDialog(true);
                }}
              >
                <Mic size={16} />
                Start Meeting
              </Button>
            ) : (
              <>
                {state.phase === "listening" && (
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={state.muted ? "Unmute microphone" : "Mute microphone"}
                    onClick={() => void host.controller?.toggleMute()}
                  >
                    {state.muted ? <MicOff size={18} /> : <Mic size={18} />}
                  </Button>
                )}
                <Button variant="outline" onClick={() => void host.controller?.end()}>
                  <Square size={14} />
                  End meeting
                </Button>
              </>
            )}
          </div>
          <label className="mt-5 flex items-center gap-3 text-sm text-muted-foreground">
            <Switch size="sm" checked={solo} onCheckedChange={setSolo} />
            <span>
              Just me <span className="text-xs">· answer everything, no name needed</span>
            </span>
          </label>
          {state.phase === "listening" && (
            <label className="mt-5 flex items-center gap-3 text-muted-foreground">
              <Volume2 size={15} />
              <input
                type="range"
                aria-label="Speaker volume"
                min="0"
                max="1"
                step="0.05"
                value={state.volume}
                onChange={(event) => host.controller?.setVolume(Number(event.target.value))}
              />
            </label>
          )}
          {state.phase === "listening" && state.playbackError && (
            <div className="mt-4 max-w-md text-sm" role="alert">
              <p className="text-destructive">{state.playbackError}</p>
              <Button variant="outline" onClick={() => void host.controller?.resumeSpeaker()}>
                <Volume2 size={16} />
                Enable speaker
              </Button>
            </div>
          )}
          {!active && connected && !supportsPucko && (
            <p className="mt-4 text-sm text-muted-foreground">
              Update Bara on {environment?.label} to use Pucko.
            </p>
          )}
          {!active && supportsPucko && configuration?.keySource === "missing" && (
            <div className="mt-4">
              <Button variant="link" onClick={() => setSettings(true)}>
                Connect OpenAI voice to begin
              </Button>
            </div>
          )}
          {!active && connected && supportsPucko && !allowed && (
            <p className="mt-4 text-sm text-muted-foreground">
              This connection needs permission to operate agents and read their results.
            </p>
          )}
          {query.error && (
            <div role="alert" className="mt-4 text-sm text-destructive">
              Could not load Pucko on this server.{" "}
              <Button variant="link" onClick={query.refresh}>
                Retry connection
              </Button>
            </div>
          )}
          {(state.error || error) && (
            <p role="alert" className="mt-5 max-w-md text-sm text-destructive">
              {state.error || error}
            </p>
          )}
          {state.phase === "ended" && current?.summaryPageId && (
            <p className="mt-5 text-sm text-muted-foreground">
              Meeting notes saved.{" "}
              <Button
                variant="link"
                onClick={() => {
                  setHistory(true);
                  setSelectedMeeting(current.id);
                }}
              >
                Read notes
              </Button>
            </p>
          )}
          {state.phase === "ended" &&
            current &&
            !current.summaryPageId &&
            current.requests.some((request) => request.requestId.startsWith("notes-")) && (
              <p className="mt-5 text-sm text-muted-foreground">
                {current.requests.find((request) => request.requestId.startsWith("notes-"))
                  ?.status === "failed"
                  ? "Notes could not be prepared. Open the meeting details to review the failure."
                  : "Preparing meeting notes in Bara…"}
              </p>
            )}
          {current && pending.length > 0 && (
            <p className="mt-5 text-xs text-muted-foreground">
              {pending.length} {pending.length === 1 ? "task" : "tasks"} in progress ·{" "}
              <Button
                variant="link"
                size="sm"
                onClick={() => {
                  setHistory(true);
                  setSelectedMeeting(current.id);
                }}
              >
                View work
              </Button>
            </p>
          )}
        </div>
        {chat && (
          <aside
            className="flex min-h-0 w-[min(440px,42vw)] shrink-0 flex-col border-l border-border max-[900px]:h-[60dvh] max-[900px]:w-full max-[900px]:border-t max-[900px]:border-l-0"
            aria-label="Chat with Pucko"
            data-side-chat-pane
          >
            <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4 text-sm">
              <span className="font-medium">Chat</span>
              {homeThreadId && environmentId && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Open the conversation full screen"
                  onClick={() => void openConversation()}
                >
                  <Maximize2 size={14} />
                </Button>
              )}
            </div>
            <div className="relative flex min-h-0 flex-1 flex-col">
              {homeThreadId && environmentId ? (
                <BackgroundThreadContext value>
                  <ComposerHandleContext value={null}>
                    <ChatView
                      environmentId={environmentId}
                      threadId={homeThreadId}
                      routeKind="server"
                      embedded={{
                        openToolDiff: () => void openConversation(),
                        runShellCommand: () => void openConversation(),
                      }}
                    />
                  </ComposerHandleContext>
                </BackgroundThreadContext>
              ) : (
                <p className="m-auto max-w-xs p-6 text-center text-sm text-muted-foreground">
                  {!connected
                    ? "Connect to Bara to chat with Pucko."
                    : query.data && homeThreadId === undefined
                      ? `Update Bara on ${environment?.label ?? "this server"} to chat with Pucko.`
                      : query.data
                        ? "Pucko's conversation could not be prepared. Check that a provider is ready, then reopen this page."
                        : "Opening the conversation…"}
                </p>
              )}
            </div>
          </aside>
        )}
      </div>
      {current?.threadId && environmentId && active && (
        <div className="mx-auto w-full max-w-2xl px-6">
          <PuckoWorkApprovals environmentId={environmentId} threadId={current.threadId} />
        </div>
      )}
      {history && (
        <section
          aria-label="Meeting history"
          className="mx-auto mb-8 w-full max-w-3xl border-t border-border px-6 pt-6"
        >
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-sm font-medium">Meetings</h2>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Close meeting history"
              onClick={() => setHistory(false)}
            >
              <X size={15} />
            </Button>
          </div>
          {!meetings.length && (
            <p className="text-sm text-muted-foreground">
              Your meetings and their notes will appear here.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {meetings.map((meeting) => (
              <Button
                key={meeting.id}
                variant={meeting.id === selectedMeeting ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setSelectedMeeting(meeting.id)}
              >
                {meeting.title}
                {meeting.interrupted ? " · interrupted" : ""}
              </Button>
            ))}
          </div>
          {selected && (
            <article className="mt-6 space-y-4 text-sm">
              <h3 className="font-medium">{selected.title}</h3>
              {selected.summary ? (
                <ChatMarkdown
                  text={selected.summary}
                  cwd={undefined}
                  environmentId={environmentId ?? undefined}
                />
              ) : (
                <p className="text-muted-foreground">
                  {selected.closed
                    ? "Meeting ended. Notes are not available yet."
                    : "Meeting in progress."}
                </p>
              )}
              {selected.tasks.map((task) => (
                <p key={task.id}>
                  {task.title} · <span className="text-muted-foreground">{task.status}</span>
                </p>
              ))}
              {selected.requests
                .filter((request) =>
                  ["failed", "interrupted", "cancelled"].includes(request.status),
                )
                .map((request) => (
                  <p key={request.requestId} className="text-destructive">
                    Request {request.status}. Review its Work conversation before retrying.
                  </p>
                ))}
              {selected.threadId && environmentId && (
                <>
                  {(!active || selected.id !== current?.id) && (
                    <PuckoWorkApprovals
                      environmentId={environmentId}
                      threadId={selected.threadId}
                    />
                  )}
                  <Link
                    to="/$environmentId/$threadId"
                    params={{ environmentId, threadId: selected.threadId }}
                  >
                    Open detailed work
                  </Link>
                </>
              )}
              {selected.closed && !selected.summaryPageId && environmentId && (
                <Button
                  variant="outline"
                  onClick={async () => {
                    const result = await command({
                      environmentId,
                      input: {
                        action: "notes",
                        id: selected.id,
                        requestId: `notes-${randomUUID()}`,
                      },
                    });
                    if (result._tag !== "Success")
                      setError(
                        "Could not prepare meeting notes. Check agent and storage permissions, then retry.",
                      );
                  }}
                >
                  Prepare meeting notes
                </Button>
              )}
              {!selected.closed && !active && environmentId && (
                <Button
                  variant="outline"
                  onClick={async () => {
                    const result = await command({
                      environmentId,
                      input: { action: "close", id: selected.id },
                    });
                    if (result._tag !== "Success")
                      setError("Could not close that interrupted meeting.");
                  }}
                >
                  Close interrupted meeting
                </Button>
              )}
            </article>
          )}
        </section>
      )}
      <details className="mx-auto mb-5 w-full max-w-3xl px-6 text-xs text-muted-foreground">
        <summary className="cursor-pointer">Developer diagnostics</summary>
        <div className="mt-3 space-y-2">
          <p>{state.stage}</p>
          {[...new Set(state.diagnostics)].map((stage) => (
            <p key={stage}>{stage}</p>
          ))}
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap">
            {state.transcript || "No transcript received."}
          </pre>
          {query.error && <p>Could not load Pucko's state from this environment.</p>}
        </div>
      </details>
      <Dialog open={consentDialog} onOpenChange={setConsentDialog}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Start a meeting with Pucko</DialogTitle>
            <DialogDescription>
              Audio goes to OpenAI while the microphone is on. Meeting text and notes are saved in
              Bara; raw audio is not stored by Bara.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="space-y-5">
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                Everyone present consents to listening and saving meeting text and notes.
              </label>
              <Button
                disabled={!consent || !ready}
                onClick={() => {
                  if (!environmentId || !consent) return;
                  setConsentDialog(false);
                  setChosen(environmentId);
                  setError("");
                  void start(
                    environmentId,
                    configuration?.activationName ?? "Citrus",
                    { projectId, coordinatorBotId: botId },
                    solo,
                  );
                }}
              >
                Start listening
              </Button>
            </div>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
      <Dialog
        open={settings}
        onOpenChange={(open) => {
          setSettings(open);
          if (!open) setApiKey("");
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Pucko settings</DialogTitle>
            <DialogDescription>
              Voice and agent work use the selected Bara server. Changes apply to the next meeting.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="space-y-5">
              <label className="grid gap-2 text-sm">
                Bara server
                <PuckoSelect
                  label="Bara server"
                  disabled={active}
                  value={environmentId ?? ""}
                  options={environments.map((env) => ({
                    value: env.environmentId,
                    label: env.label,
                  }))}
                  onChange={(value) => {
                    setChosen(value as EnvironmentId);
                    setApiKey("");
                    setNameDraft(null);
                    setProjectId(null);
                    setBotId(null);
                  }}
                />
              </label>
              <label className="grid gap-2 text-sm">
                Activation name
                <Input
                  value={name}
                  disabled={!canConfigure || active}
                  onChange={(event) => setNameDraft(event.target.value)}
                  maxLength={40}
                />
              </label>
              <label className="grid gap-2 text-sm">
                OpenAI API key
                <SecretInput
                  configured={configuration?.keySource !== "missing" && configuration !== undefined}
                  value={apiKey}
                  disabled={!canConfigure || active}
                  onChange={(event) => setApiKey(event.target.value)}
                />
              </label>
              <p className="text-xs text-muted-foreground">
                {configuration?.keySource === "environment"
                  ? "The key is provided by this server's environment. A saved key will override it."
                  : configuration?.keySource === "stored"
                    ? "A key is saved privately on this server."
                    : "Use a project key with GPT-Live access."}
              </p>
              {configuration?.keySource === "stored" && (
                <div>
                  <Button
                    variant="outline"
                    disabled={!canConfigure || active || saving}
                    onClick={() => void saveSettings(true)}
                  >
                    Remove saved key
                  </Button>
                </div>
              )}
              <label className="grid gap-2 text-sm">
                Project for agent work
                <PuckoSelect
                  label="Project for agent work"
                  disabled={active}
                  value={projectId ?? ""}
                  options={[
                    { value: "", label: "Personal Work" },
                    ...projects
                      .filter((project) => project.environmentId === environmentId)
                      .map((project) => ({ value: project.id, label: project.title })),
                  ]}
                  onChange={(value) => setProjectId(value ? ProjectId.make(value) : null)}
                />
              </label>
              <label className="grid gap-2 text-sm">
                Agent coordinator
                <PuckoSelect
                  label="Agent coordinator"
                  disabled={active}
                  value={botId ?? ""}
                  options={[
                    { value: "", label: "Default project provider" },
                    ...team.bots
                      .filter((bot) => !bot.archived && !bot.home)
                      .map((bot) => ({ value: bot.id, label: bot.config.name })),
                  ]}
                  onChange={(value) => setBotId(value ? BotId.make(value) : null)}
                />
              </label>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button
                disabled={!canConfigure || !supportsPucko || active || saving || !name.trim()}
                onClick={() => void saveSettings()}
              >
                {saving ? "Saving…" : "Save settings"}
              </Button>
            </div>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </main>
  );
}

function PuckoWorkApprovals({
  environmentId,
  threadId,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  const threadRef = { environmentId, threadId };
  const requests = useAtomValue(environmentThreadDetails.pendingRequestsAtom(threadRef));
  return (
    <>
      {requests?.approvals.map((approval) => (
        <ThreadApproval
          key={approval.requestId}
          entry={{ thread: threadRef, title: "Pucko", approval }}
        />
      ))}
      {requests?.userInputs.length ? (
        <p className="my-3 text-sm text-muted-foreground">
          Bara needs clarification.{" "}
          <Link to="/$environmentId/$threadId" params={{ environmentId, threadId }}>
            Review the question
          </Link>
        </p>
      ) : null}
      <ChildThreadApprovals threadRef={threadRef} />
    </>
  );
}

function PuckoSelect({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled: boolean;
}) {
  return (
    <Select
      value={value}
      items={options}
      disabled={disabled}
      onValueChange={(next) => {
        if (next !== null) onChange(next);
      }}
    >
      <SelectTrigger aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
