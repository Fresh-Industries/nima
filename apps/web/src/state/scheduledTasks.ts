import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { environmentAtomList, environmentIdsKey } from "./environmentAtomList";
import { serverEnvironment } from "./server";
import { useEnvironments } from "./environments";
import { formatEnvironmentQueryError } from "./query";

export const scheduledTasksListAtom = environmentAtomList(
  "web-scheduled-tasks-list",
  (environmentId) => serverEnvironment.scheduledTasksLive({ environmentId, input: {} }),
);
export const scheduledTaskCreatePermissionsAtom = environmentAtomList(
  "web-scheduled-task-create-permissions",
  serverEnvironment.upsertScheduledTask.permissionAtom,
);
export function useScheduledBots() {
  const { environments } = useEnvironments();
  const connected = environments.filter(
    (entry) => entry.connection.phase === "connected" && entry.serverConfig !== null,
  );
  const queries = useAtomValue(
    scheduledTasksListAtom(environmentIdsKey(connected.map((entry) => entry.environmentId))),
  );
  return {
    environments,
    connectedEnvironments: connected,
    bots: connected.flatMap((entry, index) => {
      const result = queries[index];
      const data = result ? AsyncResult.getOrElse(result, () => null) : null;
      return (data?.tasks ?? []).map((task) => ({ environmentId: entry.environmentId, task }));
    }),
    loading: queries.some((query) => query._tag === "Initial"),
    errors: queries.flatMap((query) =>
      query._tag === "Failure" ? [formatEnvironmentQueryError(query.cause)] : [],
    ),
    connected: connected.length > 0,
  };
}
