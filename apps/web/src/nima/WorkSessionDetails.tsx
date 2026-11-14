import { useAtomValue } from "@effect/atom-react";
import { BotAvatar } from "./BotAvatar";
import { Link } from "@tanstack/react-router";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { backgroundWorkHoldsCompletion } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { BotId, type ScopedThreadRef, type WorkspaceThreadMetadata } from "@t3tools/contracts";
import { useState } from "react";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "../components/ui/dialog";
import { useProjects, useVisibleThreadShells } from "../state/entities";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { threadEnvironment } from "../state/threads";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { useBots } from "./useBots";
import { useWorkspaceReview } from "./useWorkspaceReview";

export function WorkSessionHeader({ threadRef }: { threadRef: ScopedThreadRef }) {
  const review = useWorkspaceReview();
  const directory = useBots(threadRef.environmentId);
  const projects = useProjects();
  const thread = useVisibleThreadShells().find(
    (entry) => entry.environmentId === threadRef.environmentId && entry.id === threadRef.threadId,
  );
  const metadata = review.metadata.get(scopedThreadKey(threadRef));
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const canWrite = useAtomValue(
    serverEnvironment.writeWorkspaceReview.permissionAtom(threadRef.environmentId),
  );
  const write = useAtomCommand(serverEnvironment.writeWorkspaceReview, { reportFailure: false });
  const updateThread = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  if (
    !thread ||
    !metadata ||
    metadata.kind === "assistant" ||
    (thread.lineage.relationshipToParent === "subagent" && metadata.kind !== "focus")
  )
    return null;
  const coordinator = directory.bots.find((bot) => bot.id === metadata.coordinatorBotId);
  const project = projects.find(
    (project) =>
      project.environmentId === threadRef.environmentId && project.id === thread.projectId,
  );
  // Says where the work happens; a session with no project is simply yours.
  const scope =
    metadata.configurationRevision && metadata.scopeProjectId === null
      ? "Personal"
      : project?.title
        ? `in ${project.title}`
        : "";
  const title = metadata.title || thread.title;
  const rename = async (next: string) => {
    setError("");
    const [saved] = await Promise.all([
      write({
        environmentId: threadRef.environmentId,
        input: { action: "rename", threadId: threadRef.threadId, title: next },
      }),
      // The conversation carries the same name in tabs, search and history.
      updateThread({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, title: next },
      }),
    ]);
    if (saved._tag !== "Success") {
      const cause = squashAtomCommandFailure(saved);
      setError(cause instanceof Error ? cause.message : "Could not rename this session.");
    }
  };
  const busy = Boolean(
    metadata.workPending ||
    metadata.assistantWorkPending ||
    threadRuntimeIsActive(thread.runtime) ||
    backgroundWorkHoldsCompletion(thread.pendingBackgroundTasks),
  );
  return (
    <>
      <div className="flex min-w-0 items-center gap-3 border-b border-border/50 px-5 py-2 text-xs text-muted-foreground">
        <SessionTitle
          key={title}
          title={title}
          disabled={!canWrite}
          onRename={(next) => void rename(next)}
        />
        <span className="shrink-0 truncate">{scope}</span>
        {coordinator && (
          <Link
            to={coordinator.home ? "/" : "/bots"}
            search={
              coordinator.home
                ? {}
                : { environmentId: threadRef.environmentId, botId: coordinator.id }
            }
            className="shrink-0 truncate hover:text-foreground"
          >
            <BotAvatar
              avatar={coordinator.config.avatar}
              name={coordinator.config.name}
              seed={coordinator.id}
            />{" "}
            {coordinator.config.name}
            {coordinator.archived ? " · archived" : ""}
          </Link>
        )}
        {error && (
          <span role="alert" className="truncate text-destructive">
            {error}
          </span>
        )}
        <div className="ml-auto flex gap-2">
          <Button size="xs" variant="ghost" onClick={() => setEditing(true)}>
            Session details
          </Button>
        </div>
      </div>
      {editing && (
        <CoordinatorEditor
          threadRef={threadRef}
          metadata={metadata}
          directory={directory}
          scope={scope}
          busy={busy}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  );
}
/** The session's name; click it to rename. Enter saves, Escape cancels. */
function SessionTitle({
  title,
  disabled,
  onRename,
}: {
  title: string;
  disabled: boolean;
  onRename: (title: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    const next = draft?.trim();
    setDraft(null);
    if (next && next !== title) onRename(next);
  };
  if (draft === null)
    return (
      <button
        type="button"
        className="min-w-0 truncate rounded-sm text-sm font-medium text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:no-underline"
        aria-label={`Rename session: ${title}`}
        disabled={disabled}
        onClick={() => setDraft(title)}
      >
        {title}
      </button>
    );
  return (
    <input
      className="min-w-0 flex-1 rounded-sm border border-border bg-background px-2 py-0.5 text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      aria-label="Session title"
      autoFocus
      maxLength={240}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
        if (event.key === "Escape") setDraft(null);
      }}
    />
  );
}
function CoordinatorEditor({
  threadRef,
  metadata,
  directory,
  scope,
  busy,
  onClose,
}: {
  threadRef: ScopedThreadRef;
  metadata: WorkspaceThreadMetadata;
  directory: ReturnType<typeof useBots>;
  scope: string;
  busy: boolean;
  onClose: () => void;
}) {
  const [selection, setSelection] = useState<BotId | null>(metadata.coordinatorBotId ?? null);
  const [base, setBase] = useState(metadata.configurationRevision ?? 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const canWrite = useAtomValue(
    serverEnvironment.writeWorkspaceReview.permissionAtom(threadRef.environmentId),
  );
  const write = useAtomCommand(serverEnvironment.writeWorkspaceReview, { reportFailure: false });
  const disabled = saving || busy || !canWrite || !directory.connected;
  const save = async () => {
    if (disabled) return;
    setSaving(true);
    setError("");
    const result = await write({
      environmentId: threadRef.environmentId,
      input: {
        action: "coordinate",
        threadId: threadRef.threadId,
        coordinatorBotId: selection,
        expectedRevision: base,
      },
    });
    setSaving(false);
    if (result._tag !== "Success") {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "Could not update this session.");
      return;
    }
    onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Session details</DialogTitle>
          <DialogDescription>{scope}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <DialogPanel>
            <div className="space-y-5">
              {metadata.title && <p className="font-medium">{metadata.title}</p>}
              {metadata.objective && (
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                  {metadata.objective}
                </p>
              )}
              <label className="grid gap-2 text-sm">
                Coordinator
                <select
                  className="rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-ring"
                  disabled={disabled}
                  value={selection ?? ""}
                  onChange={(event) =>
                    setSelection(event.target.value ? BotId.make(event.target.value) : null)
                  }
                >
                  <option value="">No coordinator</option>
                  {directory.bots
                    .filter((bot) => !bot.archived || bot.id === metadata.coordinatorBotId)
                    .map((bot) => (
                      <option key={bot.id} value={bot.id}>
                        {bot.config.name}
                        {bot.archived ? " · archived" : ""}
                      </option>
                    ))}
                </select>
              </label>
              <p className="text-xs text-muted-foreground">
                The next turn uses this Bot’s instructions and this session’s context. Choose the
                model and access level in the composer.
              </p>
              {busy && (
                <p role="status" className="text-sm text-muted-foreground">
                  Work is still running. You can change the coordinator when it finishes.
                </p>
              )}
              {base !== (metadata.configurationRevision ?? 0) && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setBase(metadata.configurationRevision ?? 0);
                    setSelection(metadata.coordinatorBotId ?? null);
                    setError("");
                  }}
                >
                  Load current coordinator
                </Button>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>
              Close
            </Button>
            <Button
              type="submit"
              disabled={disabled || selection === (metadata.coordinatorBotId ?? null)}
            >
              Save coordinator
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
