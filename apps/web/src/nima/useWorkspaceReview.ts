import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentId,
  WorkspaceReviewCursor,
  WorkspaceReviewReadInput,
  WorkspaceReviewWriteInput,
} from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { useEffect, useRef } from "react";
import { useVisibleThreadShells } from "../state/entities";
import { useEnvironments } from "../state/environments";
import { formatEnvironmentQueryError } from "../state/query";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { useNimaStore } from "./store";

const reviewQueries = Atom.family((key: string) => {
  const requests = JSON.parse(key) as {
    environmentId: EnvironmentId;
    input: WorkspaceReviewReadInput;
  }[];
  return Atom.make((get) =>
    requests.map((request) => get(serverEnvironment.workspaceReviewLive(request))),
  );
});
const reviewPermissions = Atom.family((key: string) =>
  Atom.make((get) =>
    (JSON.parse(key) as EnvironmentId[]).map((id) =>
      get(serverEnvironment.writeWorkspaceReview.permissionAtom(id)),
    ),
  ),
);
const botReviews = Atom.family((key: string) =>
  Atom.make((get) =>
    (JSON.parse(key) as EnvironmentId[]).map((environmentId) =>
      get(serverEnvironment.botsLive({ environmentId, input: {} })),
    ),
  ),
);

export function useWorkspaceReview(
  view: "review" | "settled" = "review",
  before: Record<string, WorkspaceReviewCursor> = {},
) {
  const threads = useVisibleThreadShells();
  const { environments } = useEnvironments();
  const connected = environments.filter(
    (entry) =>
      entry.connection.phase === "connected" &&
      entry.serverConfig !== null &&
      (entry.serverConfig.environment.capabilities.workspaceReview ??
        entry.serverConfig.environment.capabilities.botCapabilities) === true,
  );
  const requests = connected.map(({ environmentId }) => ({
    environmentId,
    input: {
      threadIds: threads
        .filter((thread) => thread.environmentId === environmentId)
        .map((thread) => thread.id)
        .sort()
        .slice(0, 1000),
      view,
      ...(before[environmentId] ? { before: before[environmentId] } : {}),
    },
  }));
  const queries = useAtomValue(reviewQueries(JSON.stringify(requests)));
  const botQueries = useAtomValue(
    botReviews(
      JSON.stringify(
        connected
          .filter((entry) => entry.serverConfig?.environment.capabilities.botCapabilities)
          .map((entry) => entry.environmentId),
      ),
    ),
  );
  const approvalsPending = botQueries.reduce(
    (sum, query) =>
      sum +
      (AsyncResult.getOrElse(query, () => null)?.approvals?.filter(
        (item) => item.status === "pending",
      ).length ?? 0),
    0,
  );
  const permissions = useAtomValue(
    reviewPermissions(JSON.stringify(connected.map((entry) => entry.environmentId))),
  );
  const hosts = connected.map((entry, index) => ({
    environmentId: entry.environmentId,
    canWrite: permissions[index] ?? false,
    data: queries[index] ? AsyncResult.getOrElse(queries[index], () => null) : null,
  }));
  const metadata = new Map(
    hosts.flatMap((host) =>
      (host.data?.metadata ?? []).map(
        (meta) =>
          [scopedThreadKey(scopeThreadRef(host.environmentId, meta.threadId)), meta] as const,
      ),
    ),
  );
  const items = hosts
    .flatMap((host) =>
      (host.data?.items ?? []).map((item) => ({
        ...item,
        environmentId: host.environmentId,
        canWrite: host.canWrite,
      })),
    )
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt) || b.key.localeCompare(a.key));
  return {
    hosts,
    metadata,
    items,
    pendingCount:
      hosts.reduce((sum, host) => sum + (host.data?.pendingCount ?? 0), 0) + approvalsPending,
    connected: connected.length > 0,
    loading: queries.some((query) => query._tag === "Initial"),
    errors: queries.flatMap((query, index) =>
      query._tag === "Failure"
        ? [`${connected[index]?.label ?? "Workspace"}: ${formatEnvironmentQueryError(query.cause)}`]
        : [],
    ),
  };
}

/** Import existing browser metadata once; a server record always takes precedence afterwards. */
export function useImportWorkspaceReview(review: ReturnType<typeof useWorkspaceReview>) {
  const focus = useNimaStore((state) => state.focus);
  const daily = useNimaStore((state) => state.daily);
  const assistant = useNimaStore((state) => state.assistantConversation);
  const attempted = useRef(new Set<string>());
  const write = useAtomCommand(serverEnvironment.writeWorkspaceReview, { reportFailure: false });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- migrates legacy browser identities to shared server metadata only when no server identity exists
  useEffect(() => {
    if (!review.connected) attempted.current.clear();
    const candidates: { environmentId: EnvironmentId; input: WorkspaceReviewWriteInput }[] = [];
    for (const host of review.hosts) {
      if (!host.canWrite || !host.data) continue;
      for (const meta of host.data.metadata) {
        const key = scopedThreadKey(scopeThreadRef(host.environmentId, meta.threadId));
        if (meta.kind || attempted.current.has(key)) continue;
        const personal = [assistant, ...Object.values(daily)].some(
          (value) =>
            value?.environmentId === host.environmentId && value.threadId === meta.threadId,
        );
        const legacy = focus[key];
        if (!personal && !legacy) continue;
        attempted.current.add(key);
        candidates.push({
          environmentId: host.environmentId,
          input: {
            action: "remember",
            threadId: meta.threadId,
            kind: personal ? "assistant" : "focus",
            title: legacy?.title.slice(0, 240) ?? "",
            objective: legacy?.objective.slice(0, 20000) ?? "",
            review: !personal && Boolean(legacy?.review),
          },
        });
      }
    }
    void (async () => {
      for (const candidate of candidates) await write(candidate);
    })();
  }, [review.hosts, review.connected, focus, daily, assistant, write]);
}
