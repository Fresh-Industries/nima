import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { HOME_BOT_ID, type EnvironmentId, type ProjectId, type ThreadId } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { useNavigate } from "@tanstack/react-router";
import { ArrowUp, ChevronDown, FolderClosed } from "lucide-react";
import { useRef, useState } from "react";
import { useComposerDraftStore } from "../composerDraftStore";
import { useScratchProject } from "../hooks/useScratchProject";
import { useEnvironmentSettings } from "../hooks/useSettings";
import { newMessageId, newThreadId } from "../lib/utils";
import { useProjects } from "../state/entities";
import { serverEnvironment } from "../state/server";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import styles from "./DeskBoard.module.css";

const PROJECT_KEY = "bara.desk.project";
const NO_PROJECT = "none";

function readProject(): string {
  try {
    return localStorage.getItem(PROJECT_KEY) ?? NO_PROJECT;
  } catch {
    return NO_PROJECT;
  }
}

const nowIso = () => new Date().toISOString();

/** A session name from the first words of what was typed. */
function titleFrom(text: string) {
  const words = text.trim().split(/\s+/).slice(0, 7).join(" ");
  return words.length > 60 ? `${words.slice(0, 57)}…` : words;
}

/**
 * Type what you want, pick where it happens, press Enter: the session is created, your message
 * is sent, and the conversation opens. "More options" keeps the full form for coordinators.
 */
export function DeskQuickStart({
  environmentId,
  projectId: fixedProjectId,
  onMoreOptions,
}: {
  environmentId: EnvironmentId;
  projectId?: ProjectId | undefined;
  onMoreOptions: (text: string) => void;
}) {
  const scratch = useScratchProject();
  const projects = useProjects().filter(
    (project) =>
      project.environmentId === environmentId &&
      project.archivedAt == null &&
      !project.isScratch &&
      (project.title !== "No project" || !/[/\\]scratch$/i.test(project.workspaceRoot)) &&
      project.workspaceRoot !== scratch.scratchWorkspaceRootFor(environmentId),
  );
  const [chosen, setChosen] = useState(readProject);
  const projectKey = fixedProjectId ?? chosen;
  const project = projects.find((entry) => entry.id === projectKey) ?? null;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef<{ text: string; threadId: ThreadId } | null>(null);
  const settings = useEnvironmentSettings(environmentId);
  const canCreate = useAtomValue(serverEnvironment.createWorkSession.permissionAtom(environmentId));
  const create = useAtomCommand(serverEnvironment.createWorkSession, { reportFailure: false });
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });
  const navigate = useNavigate();
  const choose = (value: string) => {
    setChosen(value);
    try {
      localStorage.setItem(PROJECT_KEY, value);
    } catch {
      // Only remembers your last choice in this browser.
    }
  };
  const submit = async () => {
    const message = text.trim();
    if (!message || busy || !canCreate) return;
    setBusy(true);
    setError("");
    // A retry of the same text reuses its session, so a slow first try cannot make two.
    if (attempt.current?.text !== message)
      attempt.current = { text: message, threadId: newThreadId() };
    const threadId = attempt.current.threadId;
    const created = await create({
      environmentId,
      input: {
        threadId,
        title: titleFrom(message),
        objective: message,
        projectId: project?.id ?? null,
        coordinatorBotId: HOME_BOT_ID,
      },
    });
    if (created._tag !== "Success") {
      const cause = squashAtomCommandFailure(created);
      setError(cause instanceof Error ? cause.message : "Could not start this session.");
      setBusy(false);
      return;
    }
    const ref = scopeThreadRef(environmentId, created.value.threadId);
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId, threadId: created.value.threadId },
    });
    const sent = await startTurn({
      environmentId,
      input: {
        threadId: created.value.threadId,
        message: { messageId: newMessageId(), role: "user", text: message, attachments: [] },
        runtimeMode: resolveProjectSettings(settings, project?.id ?? null).settings
          .defaultRuntimeMode,
        interactionMode: "default",
        createdAt: nowIso(),
      },
    });
    // If sending fails, the message waits in the conversation's composer instead of vanishing.
    if (sent._tag !== "Success") useComposerDraftStore.getState().setPrompt(ref, message);
    attempt.current = null;
    setText("");
    setBusy(false);
  };
  return (
    <form
      className={styles.composer}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <input
        aria-label="Start new work"
        placeholder={project ? `What should we do in ${project.title}?` : "What should we work on?"}
        value={text}
        disabled={busy}
        onChange={(event) => setText(event.target.value)}
      />
      {!fixedProjectId && (
        <label className={styles.project}>
          <FolderClosed size={14} aria-hidden />
          <span>{project?.title ?? "No project"}</span>
          <ChevronDown size={13} aria-hidden />
          <select
            aria-label="Project"
            value={project ? project.id : NO_PROJECT}
            onChange={(event) => choose(event.target.value)}
          >
            <option value={NO_PROJECT}>No project</option>
            {projects.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.title}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        type="button"
        className={styles.more}
        disabled={busy}
        onClick={() => onMoreOptions(text)}
      >
        More options
      </button>
      <button
        type="submit"
        className={styles.send}
        aria-label="Start"
        disabled={busy || !text.trim() || !canCreate}
      >
        <ArrowUp size={16} />
      </button>
      {error && (
        <p role="alert" className={styles.composerError}>
          {error}
        </p>
      )}
    </form>
  );
}
