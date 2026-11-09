import { useAtomValue } from "@effect/atom-react";
import type { WorkspaceNote } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";
import { useStableCallback } from "../hooks/useStableCallback";
import { useEnvironment, usePrimaryEnvironmentId } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import {
  createNoteDraft,
  noteHasConflict,
  noteIsDirty,
  receiveNote,
  type NoteDraft,
} from "./notes";
import { useNimaStore } from "./store";

export function useWorkspaceNotes() {
  const environmentId = usePrimaryEnvironmentId();
  const environment = useEnvironment(environmentId);
  const connected = environment?.connection.phase === "connected";
  const query = useEnvironmentQuery(
    environmentId ? serverEnvironment.workspaceNotesLive({ environmentId, input: {} }) : null,
  );
  const canWrite = useAtomValue(serverEnvironment.writeWorkspaceNote.permissionAtom(environmentId));
  const stored = useNimaStore((state) =>
    environmentId ? state.noteDrafts[environmentId] : undefined,
  );
  const legacy = useNimaStore((state) => state.notes);
  const draft = stored ?? createNoteDraft(legacy);
  const [reply, setReply] = useState<{ environmentId: string; note: WorkspaceNote } | null>(null);
  const remote =
    reply?.environmentId === environmentId &&
    (!query.data || reply.note.revision > query.data.revision)
      ? reply.note
      : query.data;
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [localError, setLocalError] = useState(false);
  const busy = useRef(false);
  const write = useAtomCommand(serverEnvironment.writeWorkspaceNote, { reportFailure: false });

  const persist = useStableCallback((next: NoteDraft) => {
    try {
      if (!environmentId) {
        useNimaStore.getState().saveNotes(next.markdown);
        setLocalError(false);
        return;
      }
      useNimaStore.getState().setNoteDraft(environmentId, next);
      setLocalError(false);
    } catch {
      setLocalError(true);
    }
  });
  const current = useStableCallback(() =>
    environmentId
      ? (useNimaStore.getState().noteDrafts[environmentId] ??
        createNoteDraft(useNimaStore.getState().notes))
      : draft,
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reconciles the authenticated server stream with a durable local draft, including saves whose reply was lost
  useEffect(() => {
    if (!environmentId || !remote) return;
    const previous = current();
    const next = receiveNote(previous, remote);
    if (next !== previous || !useNimaStore.getState().noteDrafts[environmentId]) persist(next);
  }, [environmentId, remote, current, persist]);

  const [wasConnected, setWasConnected] = useState(connected);
  if (wasConnected !== connected) {
    setWasConnected(connected);
    if (connected) setSaveError(null);
  }

  const conflict = noteHasConflict(draft, remote);
  const dirty = noteIsDirty(draft);
  const save = useStableCallback(async () => {
    if (
      !environmentId ||
      !connected ||
      !canWrite ||
      !query.isSuccess ||
      busy.current ||
      noteHasConflict(current(), remote)
    )
      return;
    const submitted = current();
    if (!noteIsDirty(submitted)) return;
    busy.current = true;
    setSaving(true);
    setSaveError(null);
    persist({ ...submitted, pendingMarkdown: submitted.markdown });
    const result = await write({
      environmentId,
      input: { markdown: submitted.markdown, expectedRevision: submitted.baseRevision },
    });
    if (result._tag === "Success") {
      setReply({ environmentId, note: result.value.note });
      const active = useNimaStore.getState().noteDrafts[environmentId] ?? submitted;
      const next = receiveNote(active, result.value.note);
      // A response still belongs to its original host if the primary connection changed meanwhile.
      try {
        useNimaStore.getState().setNoteDraft(environmentId, next);
      } catch {
        setLocalError(true);
      }
      if (result.value.status === "conflict")
        setSaveError("Notes changed elsewhere. Choose which version to keep.");
    } else {
      const latest = useNimaStore.getState().noteDrafts[environmentId] ?? submitted;
      if (
        latest.baseRevision <= submitted.baseRevision ||
        latest.baseMarkdown !== submitted.markdown
      )
        setSaveError("Could not save to Bara. Your draft is kept on this device.");
    }
    busy.current = false;
    setSaving(false);
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- debounces external server writes; the local recovery draft is saved immediately by the edit handler
  useEffect(() => {
    if (
      !environmentId ||
      !connected ||
      !canWrite ||
      !query.isSuccess ||
      !dirty ||
      conflict ||
      saving ||
      saveError
    )
      return;
    const { markdown, baseRevision } = draft;
    const timer = window.setTimeout(() => {
      const latest = current();
      if (latest.markdown === markdown && latest.baseRevision === baseRevision) void save();
    }, 650);
    return () => window.clearTimeout(timer);
  }, [
    environmentId,
    connected,
    canWrite,
    query.isSuccess,
    dirty,
    draft,
    current,
    conflict,
    saving,
    saveError,
    save,
  ]);

  const resolveConflict = (server: WorkspaceNote, keepDraft: boolean) => {
    persist({
      markdown: keepDraft ? current().markdown : server.markdown,
      baseMarkdown: server.markdown,
      baseRevision: server.revision,
      pendingMarkdown: null,
    });
    setSaveError(null);
  };

  return {
    environmentId,
    draft,
    remote,
    conflict,
    dirty,
    saving,
    canSave: connected && canWrite && query.isSuccess,
    canRetry: connected && query.error !== null,
    canEdit: !connected || canWrite,
    status: localError
      ? "Could not keep a recovery copy. Copy your draft before closing."
      : (saveError ??
        (conflict
          ? "Notes changed elsewhere. Your draft is safe."
          : !connected
            ? "Offline · draft kept on this device"
            : !canWrite
              ? "Read-only · editing requires file write access"
              : query.error
                ? "Could not load server notes. Your draft is safe."
                : !query.isSuccess
                  ? "Connecting notes…"
                  : saving
                    ? "Saving…"
                    : dirty
                      ? "Draft kept on this device · waiting to save"
                      : "Saved to Bara")),
    retry: () => {
      setSaveError(null);
      query.refresh();
      void save();
    },
    edit: (markdown: string) => {
      persist({ ...current(), markdown });
      setSaveError(null);
    },
    useServerVersion: () => {
      if (remote) resolveConflict(remote, false);
    },
    keepDraft: () => {
      if (remote) resolveConflict(remote, true);
    },
  };
}
