import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, WorkspaceGoal, WorkspaceGoalContent } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";
import { useStableCallback } from "../hooks/useStableCallback";
import { randomUUID } from "../lib/utils";
import { useEnvironment, usePrimaryEnvironmentId } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import {
  createGoalDraft,
  goalHasConflict,
  goalIsDirty,
  newGoalContent,
  receiveGoal,
  receiveGoals,
  validGoalContent,
  type GoalDraft,
  type GoalWorkspace,
} from "./goals";
import { useNimaStore } from "./store";

const EMPTY_DRAFTS: Record<string, GoalDraft> = {};

export function useWorkspaceGoals(selectedEnvironmentId?: EnvironmentId) {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const environmentId = selectedEnvironmentId ?? primaryEnvironmentId;
  const environment = useEnvironment(environmentId);
  const connected = environment?.connection.phase === "connected";
  const query = useEnvironmentQuery(
    environmentId ? serverEnvironment.workspaceGoalsLive({ environmentId, input: {} }) : null,
  );
  const canWrite = useAtomValue(serverEnvironment.writeWorkspaceGoal.permissionAtom(environmentId));
  const workspace = useNimaStore((state) =>
    environmentId ? state.goalWorkspaces[environmentId] : undefined,
  );
  const drafts = workspace?.drafts ?? EMPTY_DRAFTS;
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [localError, setLocalError] = useState(false);
  const busy = useRef(new Set<string>());
  const write = useAtomCommand(serverEnvironment.writeWorkspaceGoal, { reportFailure: false });
  const append = useAtomCommand(serverEnvironment.addWorkspaceGoalProgress, {
    reportFailure: false,
  });
  const keyFor = (id: string) => `${environmentId}:${id}`;

  const persist = useStableCallback((host: string, next: GoalWorkspace) => {
    try {
      useNimaStore.getState().setGoalWorkspace(host, next);
      setLocalError(false);
    } catch {
      setLocalError(true);
    }
  });
  const updateAt = useStableCallback(
    (host: string, id: string, change: (draft: GoalDraft) => GoalDraft) => {
      const current = useNimaStore.getState().goalWorkspaces[host];
      const previous = current?.drafts[id];
      if (current && previous)
        persist(host, { drafts: { ...current.drafts, [id]: change(previous) } });
    },
  );
  const accept = useStableCallback((host: string, goal: WorkspaceGoal) =>
    updateAt(host, goal.id, (draft) => receiveGoal(draft, goal)),
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- merges the authenticated server stream into durable recovery drafts and imports legacy browser goals once
  useEffect(() => {
    if (!environmentId || !query.data) return;
    const state = useNimaStore.getState();
    const legacy =
      state.legacyGoalsEnvironmentId === null || state.legacyGoalsEnvironmentId === environmentId
        ? state.goals
        : [];
    persist(environmentId, receiveGoals(state.goalWorkspaces[environmentId], query.data, legacy));
  }, [environmentId, query.data, persist]);

  const [wasConnected, setWasConnected] = useState(connected);
  if (wasConnected !== connected) {
    setWasConnected(connected);
    if (connected) setErrors({});
  }

  const save = useStableCallback(async (id: string) => {
    if (!environmentId || !connected || !canWrite || !query.isSuccess) return;
    const host = environmentId;
    const key = `${host}:${id}`;
    const draft = useNimaStore.getState().goalWorkspaces[host]?.drafts[id];
    if (
      !draft ||
      busy.current.has(key) ||
      goalHasConflict(draft) ||
      !goalIsDirty(draft) ||
      !validGoalContent(draft.content)
    )
      return;
    busy.current.add(key);
    setSaving((previous) => ({ ...previous, [key]: true }));
    setErrors((previous) => ({ ...previous, [key]: null }));
    updateAt(host, id, (current) => ({ ...current, pendingContent: draft.content }));
    const result = await write({
      environmentId: host,
      input: { id, content: draft.content, expectedRevision: draft.baseRevision },
    });
    if (result._tag === "Success" && result.value.goal) accept(host, result.value.goal);
    else
      setErrors((previous) => ({
        ...previous,
        [key]: "Could not save to Bara. Your draft is kept on this device.",
      }));
    busy.current.delete(key);
    setSaving((previous) => ({ ...previous, [key]: false }));
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- debounces server writes while each edit is immediately persisted as a local recovery draft
  useEffect(() => {
    if (!environmentId || !connected || !canWrite || !query.isSuccess) return;
    const pending = Object.entries(drafts).filter(
      ([id, draft]) =>
        goalIsDirty(draft) &&
        !goalHasConflict(draft) &&
        validGoalContent(draft.content) &&
        !saving[`${environmentId}:${id}`] &&
        !errors[`${environmentId}:${id}`],
    );
    if (!pending.length) return;
    const timer = window.setTimeout(() => {
      for (const [id] of pending) void save(id);
    }, 650);
    return () => window.clearTimeout(timer);
  }, [environmentId, connected, canWrite, query.isSuccess, drafts, saving, errors, save]);

  const edit = (id: string, change: (content: WorkspaceGoalContent) => WorkspaceGoalContent) => {
    if (!environmentId || (connected && !canWrite)) return;
    updateAt(environmentId, id, (draft) => ({ ...draft, content: change(draft.content) }));
    setErrors((previous) => ({ ...previous, [keyFor(id)]: null }));
  };
  const add = (title: string) => {
    if (!environmentId || !workspace || !title.trim() || (connected && !canWrite)) return null;
    const id = randomUUID();
    const current = useNimaStore.getState().goalWorkspaces[environmentId]!;
    persist(environmentId, {
      drafts: { ...current.drafts, [id]: createGoalDraft(newGoalContent(title.trim())) },
    });
    void save(id);
    return id;
  };
  const resolve = (id: string, useServer: boolean) => {
    if (!environmentId) return;
    updateAt(environmentId, id, (draft) =>
      draft.remote
        ? {
            ...draft,
            content: useServer ? draft.remote.content : draft.content,
            baseContent: draft.remote.content,
            baseRevision: draft.remote.revision,
            pendingContent: null,
          }
        : draft,
    );
    setErrors((previous) => ({ ...previous, [keyFor(id)]: null }));
  };
  const editProgress = (id: string, text: string) => {
    if (!environmentId || (connected && !canWrite)) return;
    updateAt(environmentId, id, (draft) => ({
      ...draft,
      progressText: text,
      progressId: randomUUID(),
      pendingProgress: null,
    }));
  };
  const postProgress = useStableCallback(async (id: string) => {
    if (!environmentId || !connected || !canWrite || !query.isSuccess) return;
    const host = environmentId;
    const key = `${host}:${id}`;
    const draft = useNimaStore.getState().goalWorkspaces[host]?.drafts[id];
    if (!draft?.remote || !draft.progressText.trim() || busy.current.has(key)) return;
    const entry = draft.pendingProgress ?? {
      id: draft.progressId || randomUUID(),
      text: draft.progressText.trim(),
    };
    busy.current.add(key);
    setSaving((previous) => ({ ...previous, [key]: true }));
    updateAt(host, id, (current) => ({ ...current, pendingProgress: entry }));
    const result = await append({
      environmentId: host,
      input: { id, updateId: entry.id, text: entry.text },
    });
    if (result._tag === "Success" && result.value) {
      accept(host, result.value);
      updateAt(host, id, (current) =>
        current.pendingProgress?.id === entry.id
          ? { ...current, progressText: "", progressId: "", pendingProgress: null }
          : current,
      );
      setErrors((previous) => ({ ...previous, [key]: null }));
    } else
      setErrors((previous) => ({
        ...previous,
        [key]: "Could not post this update. Your draft is kept; you can retry.",
      }));
    busy.current.delete(key);
    setSaving((previous) => ({ ...previous, [key]: false }));
  });

  const status = (id: string) => {
    const draft = drafts[id];
    if (!draft) return "";
    if (localError) return "Could not keep a recovery copy. Keep a copy before closing.";
    if (goalHasConflict(draft)) return "Changed elsewhere · your draft is kept";
    if (!connected) return "Offline · draft kept on this device";
    if (!canWrite) return "Read-only access";
    if (errors[keyFor(id)]) return errors[keyFor(id)];
    if (!validGoalContent(draft.content))
      return "Give the goal a title and use a valid target date.";
    if (saving[keyFor(id)]) return "Saving…";
    return goalIsDirty(draft) ? "Draft saved on this device" : "Saved to Bara";
  };
  return {
    environmentId,
    drafts,
    connected,
    add,
    edit,
    resolve,
    save,
    editProgress,
    postProgress,
    status,
    canEdit: Boolean(environmentId && workspace && (!connected || canWrite)),
    creationUnavailableReason: !environmentId
      ? "Connect a Bara server to save a goal."
      : !workspace
        ? connected
          ? "Waiting for your goals to load. Retry the connection if this continues."
          : "Reconnect to Bara before creating your first goal on this device."
        : connected && !canWrite
          ? "This connection has read-only access to Goals."
          : null,
    canPost: connected && canWrite && query.isSuccess,
    loading: connected && !workspace && query.isPending,
    error: localError
      ? "Local recovery storage is unavailable. Keep a copy before closing."
      : query.error,
    refresh: query.refresh,
    isSaving: (id: string) => Boolean(saving[keyFor(id)]),
    canRetry: (id: string) => connected && canWrite && Boolean(errors[keyFor(id)]),
  };
}
