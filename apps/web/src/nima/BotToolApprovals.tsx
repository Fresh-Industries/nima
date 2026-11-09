import { Link } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";
import { useEnvironments } from "../state/environments";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { Button } from "../components/ui/button";
import { useBots } from "./useBots";
import { resolveT3McpToolPresentation } from "@t3tools/shared/t3McpToolPresentation";

const actionLabels = new Map([
  ["t3_notes_write", "Update notes"],
  ["t3_pages_write", "Update a Library document"],
  ["t3_pages_capture", "Save a result to Library"],
  ["t3_goals_write", "Save a goal"],
]);

function HostApprovals({
  environmentId,
  settled,
}: {
  environmentId: EnvironmentId;
  settled: boolean;
}) {
  const state = useBots(environmentId);
  const canWrite = useAtomValue(serverEnvironment.resolveBotApproval.permissionAtom(environmentId));
  const resolve = useAtomCommand(serverEnvironment.resolveBotApproval, { reportFailure: false });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const items = state.approvals.filter((item) =>
    settled
      ? item.status === "consumed" || item.status === "rejected" || item.status === "invalidated"
      : item.status === "pending" || item.status === "approved",
  );
  if (!items.length) return null;
  return (
    <section
      aria-label="Bot action approvals"
      className="mb-8 space-y-3 border-b border-border pb-6"
    >
      <h2 className="text-sm font-medium">Needs your approval</h2>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {items.map((item) => (
        <article key={item.id} className="space-y-2 py-3 text-sm">
          <p>
            <strong>{item.botNames.join(" / ")}</strong> ·{" "}
            {actionLabels.get(item.tool) ??
              resolveT3McpToolPresentation(item.tool)?.displayName ??
              item.tool}
          </p>
          <details>
            <summary className="cursor-pointer text-muted-foreground">
              Review exact arguments
            </summary>
            <p className="mt-3 font-mono text-xs text-muted-foreground">{item.tool}</p>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded border border-border p-3 text-xs">
              {item.arguments}
            </pre>
          </details>
          <p className="text-xs text-muted-foreground">
            {item.status === "pending"
              ? "No action has run. Approve one attempt with these exact inputs. Existing tool and resource restrictions still apply."
              : item.status === "approved"
                ? "Approved for one retry. Open the conversation and ask the Bot to retry the action."
                : item.status === "consumed"
                  ? "Permission used for one attempt. Open the conversation to inspect its outcome."
                  : item.status === "invalidated"
                    ? "Settings or resources changed. This approval no longer applies."
                    : "Declined."}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {item.status === "pending" &&
              (["approved", "rejected"] as const).map((decision) => (
                <Button
                  key={decision}
                  size="sm"
                  variant={decision === "approved" ? "default" : "ghost"}
                  disabled={busy || !canWrite || !state.connected}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    const result = await resolve({
                      environmentId,
                      input: { id: item.id, decision, expectedRevision: item.revision },
                    });
                    setBusy(false);
                    if (result._tag !== "Success") {
                      state.query.refresh();
                      setError("This review changed or expired. Review the current action.");
                    }
                  }}
                >
                  {decision === "approved" ? "Approve one retry" : "Decline"}
                </Button>
              ))}
            {(item.status === "rejected" || item.status === "approved") && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || !canWrite || !state.connected}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  const result = await resolve({
                    environmentId,
                    input: {
                      id: item.id,
                      decision: item.status === "approved" ? "rejected" : "pending",
                      expectedRevision: item.revision,
                    },
                  });
                  setBusy(false);
                  if (result._tag !== "Success")
                    setError("This review changed or expired. Refresh Inbox.");
                }}
              >
                {item.status === "approved" ? "Revoke approval" : "Reopen review"}
              </Button>
            )}
            <Link
              to="/$environmentId/$threadId"
              params={{ environmentId, threadId: item.threadId }}
              className="text-xs text-muted-foreground"
            >
              Open conversation →
            </Link>
          </div>
        </article>
      ))}
    </section>
  );
}
export function BotToolApprovals({ settled = false }: { settled?: boolean }) {
  const { environments } = useEnvironments();
  return environments
    .filter(
      (env) =>
        env.connection.phase === "connected" &&
        env.serverConfig?.environment.capabilities.botCapabilities,
    )
    .map((env) => (
      <HostApprovals key={env.environmentId} environmentId={env.environmentId} settled={settled} />
    ));
}
