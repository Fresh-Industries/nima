import { useAtomValue } from "@effect/atom-react";
import { clampManagedRuntimeMode, type EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";
import { scheduledTaskDefaultModel } from "../components/settings/scheduledTasksSettings.logic";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Switch } from "../components/ui/switch";
import { useEnvironmentSettings } from "../hooks/useSettings";
import { providerInstanceEntriesFor } from "../providerInstances";
import { useProjects, useVisibleThreadShells } from "../state/entities";
import { useEnvironment } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { DAILY_BRIEF_PROMPT, DAILY_BRIEF_TASK_ID, DAILY_BRIEF_TITLE } from "./assistantBrief";
import { usePersonalAssistant } from "./usePersonalAssistant";

const DEFAULT_TIME = "08:30";

/**
 * Turns the Assistant's daily brief on and off. The brief is an ordinary routine in the
 * Assistant's own conversation, so it can also be paused or edited wherever routines are.
 */
export function AssistantBrief() {
  const { environmentId } = usePersonalAssistant();
  return environmentId ? <Brief environmentId={environmentId} /> : null;
}

function Brief({ environmentId }: { environmentId: EnvironmentId }) {
  const assistant = usePersonalAssistant();
  const environment = useEnvironment(environmentId);
  const connected = environment?.connection.phase === "connected";
  const threadId = assistant.profile?.threadId ?? null;
  const thread = useVisibleThreadShells().find(
    (entry) => entry.environmentId === environmentId && entry.id === threadId,
  );
  const tasks = useEnvironmentQuery(
    connected ? serverEnvironment.scheduledTasksLive({ environmentId, input: {} }) : null,
  );
  const task = tasks.data?.tasks.find((entry) => entry.id === DAILY_BRIEF_TASK_ID);
  const canWrite = useAtomValue(
    serverEnvironment.upsertScheduledTask.permissionAtom(environmentId),
  );
  const canRun = useAtomValue(serverEnvironment.runScheduledTaskNow.permissionAtom(environmentId));
  const upsert = useAtomCommand(serverEnvironment.upsertScheduledTask, { reportFailure: false });
  const run = useAtomCommand(serverEnvironment.runScheduledTaskNow, { reportFailure: false });
  const settings = useEnvironmentSettings(environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const project =
    useProjects().find(
      (entry) => entry.environmentId === environmentId && entry.id === thread?.projectId,
    ) ?? null;
  const selection = scheduledTaskDefaultModel(
    settings,
    project,
    providerInstanceEntriesFor(providers, settings, project?.id ?? null),
  );
  const savedTime = task?.schedule.type === "fixed_time" ? task.schedule.timeOfDay : DEFAULT_TIME;
  const [time, setTime] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const ready = Boolean(connected && thread && selection && canWrite && tasks.data);
  const save = async (enabled: boolean, timeOfDay: string) => {
    if (!thread || !selection || busy) return false;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(timeOfDay)) {
      setStatus("Use a time like 08:30.");
      return false;
    }
    setBusy(true);
    setStatus("");
    const result = await upsert({
      environmentId,
      input: {
        id: DAILY_BRIEF_TASK_ID,
        title: DAILY_BRIEF_TITLE,
        prompt: DAILY_BRIEF_PROMPT,
        enabled,
        schedule: { type: "fixed_time", timeOfDay, timeZone: assistant.config.timezone },
        projectId: thread.projectId,
        threadId: thread.id,
        ownerBotId: null,
        workspaceStrategy: { type: "root" },
        modelSelection: task?.modelSelection ?? selection,
        runtimeMode:
          clampManagedRuntimeMode(environment?.serverConfig?.managedPolicy, "approval-required") ??
          "approval-required",
        interactionMode: "default",
        creationSource: "web",
      },
    });
    setBusy(false);
    if (result._tag !== "Success") {
      setStatus("Could not save the daily brief. Try again.");
      return false;
    }
    setTime(null);
    return true;
  };
  const briefNow = async () => {
    if (busy) return;
    if (!task && !(await save(false, time ?? savedTime))) return;
    setBusy(true);
    const result = await run({ environmentId, input: { id: DAILY_BRIEF_TASK_ID } });
    setBusy(false);
    setStatus(
      result._tag === "Success"
        ? "Your brief is on its way. It appears in your Assistant conversation."
        : "Could not start the brief. Try again.",
    );
  };
  return (
    <section className="space-y-3" aria-label="Daily brief">
      <h3 className="text-sm font-semibold">Daily brief</h3>
      <p className="text-sm text-muted-foreground">
        Each day your Assistant reads your goals, recent conversations and what is waiting on you,
        then tells you what moved, what is stuck, and what to do next. It suggests work sessions you
        start with one click; it never starts work on its own. Each brief is a real agent run.
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-3 text-sm">
          <Switch
            checked={task?.enabled ?? false}
            disabled={!ready || busy}
            onCheckedChange={(enabled) => void save(enabled, time ?? savedTime)}
          />
          {task?.enabled ? "On" : "Off"}
        </label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          at
          <div className="w-24">
            <Input
              aria-label="Brief time"
              value={time ?? savedTime}
              disabled={!ready || busy}
              placeholder={DEFAULT_TIME}
              onChange={(event) => setTime(event.target.value)}
              onBlur={() => {
                if (time !== null && time !== savedTime && task) void save(task.enabled, time);
              }}
            />
          </div>
          {assistant.config.timezone}
        </label>
        <Button
          variant="outline"
          size="sm"
          disabled={!ready || !canRun || busy}
          onClick={() => void briefNow()}
        >
          Brief me now
        </Button>
      </div>
      {!ready && connected && (
        <p className="text-xs text-muted-foreground">
          {!thread
            ? "Open your Assistant conversation once to set up the brief."
            : !selection
              ? "Connect a provider to use the brief."
              : !canWrite
                ? "This connection cannot manage routines."
                : ""}
        </p>
      )}
      {(status || tasks.error) && (
        <p role="status" className="text-sm text-muted-foreground">
          {status || tasks.error}
        </p>
      )}
    </section>
  );
}
