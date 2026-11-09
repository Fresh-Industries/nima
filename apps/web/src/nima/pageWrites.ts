import {
  AuthFilesystemWriteScope,
  type EnvironmentId,
  type WorkspacePage,
} from "@t3tools/contracts";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { create } from "zustand";
import { useEffect, useRef } from "react";
import { useAtomValue } from "@effect/atom-react";
import { environmentAtomList, environmentIdsKey } from "../state/environmentAtomList";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { readEnvironment, useEnvironments } from "../state/environments";
import { readEnvironmentScope } from "../state/session";
import { serverEnvironment } from "../state/server";
import {
  acceptPage,
  pageHasConflict,
  pageIsDirty,
  validPageContent,
  type PageWorkspace,
} from "./pages";
import { useNimaStore } from "./store";

type SaveState = {
  saving: Record<string, boolean>;
  errors: Record<string, string | null>;
  recoveryError: boolean;
};
export const usePageSaveState = create<SaveState>(() => ({
  saving: {},
  errors: {},
  recoveryError: false,
}));
export const pageKey = (host: string, id: string) => JSON.stringify([host, id]);
export function storePages(host: string, workspace: PageWorkspace) {
  try {
    useNimaStore.getState().setPageWorkspace(host, workspace);
    usePageSaveState.setState({ recoveryError: false });
  } catch {
    usePageSaveState.setState({ recoveryError: true });
  }
}
export function receiveSavedPage(host: string, page: WorkspacePage) {
  const workspace = useNimaStore.getState().pageWorkspaces[host];
  const next = acceptPage(workspace, page);
  if (next.drafts[page.id] !== workspace?.drafts[page.id]) storePages(host, next);
}
export function clearPageError(host: string, id: string) {
  const state = usePageSaveState.getState();
  usePageSaveState.setState({ errors: { ...state.errors, [pageKey(host, id)]: null } });
}

export async function savePage(host: EnvironmentId, id: string) {
  const key = pageKey(host, id);
  const state = usePageSaveState.getState();
  const workspace = useNimaStore.getState().pageWorkspaces[host];
  const draft = workspace?.drafts[id];
  if (
    !draft ||
    state.saving[key] ||
    !pageIsDirty(draft) ||
    pageHasConflict(draft) ||
    !validPageContent(draft.content) ||
    readEnvironment(host)?.connection.phase !== "connected" ||
    !readEnvironmentScope(host, AuthFilesystemWriteScope)
  )
    return;
  usePageSaveState.setState({
    saving: { ...state.saving, [key]: true },
    errors: { ...state.errors, [key]: null },
  });
  storePages(host, {
    drafts: { ...workspace.drafts, [id]: { ...draft, pendingContent: draft.content } },
  });
  const result = await runAtomCommand(
    appAtomRegistry,
    serverEnvironment.writeWorkspacePage,
    {
      environmentId: host,
      input: { id, content: draft.content, expectedRevision: draft.baseRevision },
    },
    { reportFailure: false },
  );
  if (result._tag === "Success" && result.value.page) receiveSavedPage(host, result.value.page);
  const latest = usePageSaveState.getState();
  usePageSaveState.setState({
    saving: { ...latest.saving, [key]: false },
    errors: {
      ...latest.errors,
      [key]:
        result._tag === "Success"
          ? null
          : "Could not save to Bara. Your draft is kept on this device.",
    },
  });
}

const writablePages = environmentAtomList(
  "spaces-write-permissions",
  serverEnvironment.writeWorkspacePage.permissionAtom,
);

/** Keep draft saves alive across navigation, including while a result page is being opened. */
export function usePageAutosave() {
  const workspaces = useNimaStore((state) => state.pageWorkspaces);
  const saving = usePageSaveState((state) => state.saving);
  const errors = usePageSaveState((state) => state.errors);
  const { environments } = useEnvironments();
  const connected = environments
    .filter((environment) => environment.connection.phase === "connected")
    .map((environment) => environment.environmentId);
  const writable = useAtomValue(writablePages(environmentIdsKey(connected)));
  const hostsKey = connected.filter((_, index) => writable[index]).join("\n");
  const previousHosts = useRef(new Set<string>());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- retries recovery drafts when their host reconnects or restores file write access
  useEffect(() => {
    const hosts = hostsKey ? hostsKey.split("\n") : [];
    const restored = hosts.filter((host) => !previousHosts.current.has(host));
    previousHosts.current = new Set(hosts);
    const current = usePageSaveState.getState();
    if (
      Object.keys(current.errors).some(
        (key) =>
          current.errors[key] &&
          restored.some((host) => key.startsWith(`[${JSON.stringify(host)},`)),
      )
    )
      usePageSaveState.setState({
        errors: Object.fromEntries(
          Object.entries(current.errors).map(([key, error]) => [
            key,
            restored.some((host) => key.startsWith(`[${JSON.stringify(host)},`)) ? null : error,
          ]),
        ),
      });
  }, [hostsKey]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- autosaves durable page drafts independently of which workspace route is currently mounted
  useEffect(() => {
    const hosts = hostsKey ? (hostsKey.split("\n") as EnvironmentId[]) : [];
    const pending = hosts.flatMap((host) =>
      Object.entries(workspaces[host]?.drafts ?? {}).flatMap(([id, draft]) =>
        pageIsDirty(draft) &&
        !pageHasConflict(draft) &&
        validPageContent(draft.content) &&
        !saving[pageKey(host, id)] &&
        !errors[pageKey(host, id)]
          ? [{ host, id }]
          : [],
      ),
    );
    if (!pending.length) return;
    const timer = window.setTimeout(() => {
      for (const { host, id } of pending) void savePage(host, id);
    }, 650);
    return () => window.clearTimeout(timer);
  }, [workspaces, hostsKey, saving, errors]);
}
