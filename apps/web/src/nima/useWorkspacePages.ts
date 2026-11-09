import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  WorkspacePageContent,
  WorkspacePagesSubscribeInput,
} from "@t3tools/contracts";
import { useEffect } from "react";
import { randomUUID } from "../lib/utils";
import { useEnvironment, usePrimaryEnvironmentId } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";
import {
  newPageDraft,
  pageHasConflict,
  pageIsDirty,
  validPageContent,
  type PageDraft,
} from "./pages";
import {
  clearPageError,
  pageKey,
  receiveSavedPage,
  savePage,
  storePages,
  usePageSaveState,
} from "./pageWrites";
import { useNimaStore } from "./store";

const EMPTY_DRAFTS: Record<string, PageDraft> = {};
export function useWorkspacePages(
  selectedHost: EnvironmentId | undefined,
  input: WorkspacePagesSubscribeInput,
) {
  const primary = usePrimaryEnvironmentId();
  const environmentId = selectedHost ?? primary;
  const environment = useEnvironment(environmentId);
  const connected = environment?.connection.phase === "connected";
  const query = useEnvironmentQuery(
    environmentId ? serverEnvironment.workspacePagesLive({ environmentId, input }) : null,
  );
  const canWrite = useAtomValue(serverEnvironment.writeWorkspacePage.permissionAtom(environmentId));
  const workspace = useNimaStore((state) =>
    environmentId ? state.pageWorkspaces[environmentId] : undefined,
  );
  const saveState = usePageSaveState();
  const remote = query.data?.page;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reconciles the authenticated page stream with durable recovery drafts without overwriting concurrent edits
  useEffect(() => {
    if (environmentId && remote) receiveSavedPage(environmentId, remote);
  }, [environmentId, remote]);
  const drafts = workspace?.drafts ?? EMPTY_DRAFTS;
  const edit = (id: string, change: (content: WorkspacePageContent) => WorkspacePageContent) => {
    if (!environmentId || (connected && !canWrite)) return;
    const current = useNimaStore.getState().pageWorkspaces[environmentId];
    const draft = current?.drafts[id];
    if (!current || !draft) return;
    storePages(environmentId, {
      drafts: { ...current.drafts, [id]: { ...draft, content: change(draft.content) } },
    });
    clearPageError(environmentId, id);
  };
  const add = () => {
    if (!environmentId || !connected || !canWrite || !query.isSuccess) return null;
    const id = randomUUID();
    const current = useNimaStore.getState().pageWorkspaces[environmentId];
    storePages(environmentId, { drafts: { ...current?.drafts, [id]: newPageDraft() } });
    void savePage(environmentId, id);
    return id;
  };
  const resolve = (id: string, keepMine: boolean) => {
    if (!environmentId) return;
    const current = useNimaStore.getState().pageWorkspaces[environmentId];
    const draft = current?.drafts[id];
    if (!current || !draft?.remote) return;
    storePages(environmentId, {
      drafts: {
        ...current.drafts,
        [id]: {
          ...draft,
          content: keepMine ? draft.content : draft.remote.content,
          baseContent: draft.remote.content,
          baseRevision: draft.remote.revision,
          pendingContent: null,
        },
      },
    });
    clearPageError(environmentId, id);
  };
  const status = (id: string) => {
    const draft = drafts[id];
    if (!draft) return "Loading document…";
    if (saveState.recoveryError)
      return "Local recovery storage is unavailable. Keep a copy before closing.";
    if (pageHasConflict(draft)) return "Changed elsewhere · your draft is kept";
    if (!connected) return "Offline · draft kept on this device";
    if (!canWrite) return "Read-only access";
    if (!validPageContent(draft.content))
      return "Give the document a title of up to 200 characters.";
    if (saveState.errors[pageKey(environmentId ?? "", id)])
      return saveState.errors[pageKey(environmentId ?? "", id)];
    if (saveState.saving[pageKey(environmentId ?? "", id)]) return "Saving…";
    return pageIsDirty(draft) ? "Draft kept on this device · waiting to save" : "Saved to Bara";
  };
  return {
    environmentId,
    connected,
    query,
    drafts,
    canEdit: Boolean(environmentId && (!connected || canWrite)),
    creationUnavailableReason: !environmentId
      ? "Connect a Bara server to create documents."
      : !connected
        ? "Reconnect to Bara to create a document."
        : !canWrite
          ? "This connection has read-only access to Library."
          : !query.isSuccess
            ? (query.error ?? "Loading your documents…")
            : null,
    canCreate: connected && canWrite && query.isSuccess,
    add,
    edit,
    resolve,
    status,
    save: (id: string) => {
      if (environmentId) {
        clearPageError(environmentId, id);
        void savePage(environmentId, id);
      }
    },
  };
}
