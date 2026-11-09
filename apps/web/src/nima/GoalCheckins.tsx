import { usePersonalAssistant } from "./usePersonalAssistant";
import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import {
  CommandId,
  clampManagedRuntimeMode,
  type EnvironmentId,
  type WorkspaceGoal,
} from "@t3tools/contracts";
import { useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { scheduledTaskDefaultModel } from "../components/settings/scheduledTasksSettings.logic";
import { scheduleLabel, WEEKDAY_LABELS } from "../components/settings/scheduledTaskPresentation";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { useScratchProject } from "../hooks/useScratchProject";
import { useEnvironmentSettings } from "../hooks/useSettings";
import { randomUUID } from "../lib/utils";
import { providerInstanceEntriesFor } from "../providerInstances";
import { useEnvironment } from "../state/environments";
import { useProjects } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";

export function GoalCheckins({
  environmentId,
  goal,
  canSetup,
}: {
  environmentId: EnvironmentId;
  goal: WorkspaceGoal;
  canSetup: boolean;
}) {
  const environment = useEnvironment(environmentId);
  const connected = environment?.connection.phase === "connected";
  const tasks = useEnvironmentQuery(
    connected ? serverEnvironment.scheduledTasksLive({ environmentId, input: {} }) : null,
  );
  const canWrite = useAtomValue(
    serverEnvironment.upsertScheduledTask.permissionAtom(environmentId),
  );
  const toggle = useAtomCommand(serverEnvironment.setScheduledTaskEnabled, {
    reportFailure: false,
  });
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const linked = tasks.data?.tasks.filter((task) => task.goalId === goal.id) ?? [];
  const active = goal.content.status === "active";
  const setEnabled = async (id: (typeof linked)[number]["id"], enabled: boolean) => {
    if (busy) return;
    setBusy(true);
    setError("");
    const result = await toggle({ environmentId, input: { id, enabled } });
    if (result._tag !== "Success") setError("Could not update this check-in. Please try again.");
    setBusy(false);
  };
  return (
    <section className="space-y-3" aria-label="Goal check-ins">
      <div className="flex items-center justify-between gap-3">
        <h3>Check-ins</h3>
        {!adding && (
          <Button
            size="xs"
            variant="ghost"
            disabled={
              !connected || !canWrite || !canSetup || !active || !tasks.data || Boolean(tasks.error)
            }
            onClick={() => setAdding(true)}
          >
            {linked.length ? "Add another" : "Add check-in"}
          </Button>
        )}
      </div>
      {linked.map((task) => (
        <div key={task.id} className="flex items-center justify-between gap-3 text-sm">
          <Link
            to="/bots"
            search={{ environmentId, taskId: task.id }}
            className="min-w-0 hover:underline"
          >
            <span className="block truncate">{task.title}</span>
            <span className="text-xs text-muted-foreground">
              {!task.enabled
                ? "Paused"
                : !active
                  ? "Waiting for goal to resume"
                  : scheduleLabel(task.schedule)}
            </span>
          </Link>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`${task.enabled ? "Pause" : "Resume"} ${task.title}`}
            disabled={!connected || !canWrite || busy || (!task.enabled && !active)}
            onClick={() => void setEnabled(task.id, !task.enabled)}
          >
            {task.enabled ? <Pause /> : <Play />}
          </Button>
        </div>
      ))}
      {!active && (
        <p className="text-xs text-muted-foreground">
          Check-ins wait while this goal is paused, completed or archived.
        </p>
      )}
      {!canSetup && (
        <p className="text-xs text-muted-foreground">
          Save your goal changes before setting up a check-in.
        </p>
      )}
      {(error || tasks.error) && (
        <p role="alert" className="text-sm text-destructive">
          {error || tasks.error}
        </p>
      )}
      {adding && (
        <CheckinSetup
          environmentId={environmentId}
          goal={goal}
          available={connected && canWrite && canSetup && active}
          onClose={() => setAdding(false)}
        />
      )}
    </section>
  );
}

function CheckinSetup({
  environmentId,
  goal,
  available,
  onClose,
}: {
  environmentId: EnvironmentId;
  goal: WorkspaceGoal;
  available: boolean;
  onClose: () => void;
}) {
  const [cadence, setCadence] = useState<"weekly" | "daily">("weekly");
  const [weekday, setWeekday] = useState("1");
  const [time, setTime] = useState("09:00");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [commandId] = useState(() => CommandId.make(`goal-checkin:${randomUUID()}`));
  const {
    config: { timezone },
  } = usePersonalAssistant();
  const settings = useEnvironmentSettings(environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const projects = useProjects();
  const project =
    projects.find((entry) => entry.environmentId === environmentId && entry.archivedAt == null) ??
    null;
  const entries = providerInstanceEntriesFor(providers, settings, project?.id ?? null);
  const selection = scheduledTaskDefaultModel(settings, project, entries);
  const provider = entries.find((entry) => entry.instanceId === selection?.instanceId);
  const environment = useEnvironment(environmentId);
  const scratch = useScratchProject();
  const lock = useRef(false);
  const create = useAtomCommand(serverEnvironment.upsertScheduledTask, { reportFailure: false });
  const submit = async () => {
    if (!available || lock.current || !selection || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return;
    lock.current = true;
    setSaving(true);
    setError("");
    const workspace = scratch.scratchWorkspaceRootFor(environmentId)
      ? await scratch.openScratchProject(environmentId)
      : project;
    if (!workspace) {
      setError("Could not prepare the check-in’s workspace. Try again.");
      lock.current = false;
      setSaving(false);
      return;
    }
    const result = await create({
      environmentId,
      input: {
        commandId,
        goalId: goal.id,
        title: `Check-in · ${goal.content.title}`,
        prompt:
          "Help me make steady progress toward this goal. Keep the check-in brief, kind and practical.",
        enabled: true,
        schedule: {
          type: "fixed_time",
          timeOfDay: time,
          timeZone: timezone,
          ...(cadence === "weekly" ? { weekdays: [Number(weekday)] } : {}),
        },
        projectId: workspace.id,
        threadId: null,
        workspaceStrategy: { type: "root" },
        modelSelection: selection,
        runtimeMode:
          clampManagedRuntimeMode(environment?.serverConfig?.managedPolicy, "approval-required") ??
          "approval-required",
        interactionMode: "default",
        creationSource: "web",
      },
    });
    if (result._tag === "Success") onClose();
    else setError("Could not save the check-in. Your choices are kept; try again.");
    lock.current = false;
    setSaving(false);
  };
  return (
    <div className="space-y-4 rounded-lg border border-border p-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Check-in frequency">
        {(["weekly", "daily"] as const).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={cadence === value ? "secondary" : "ghost"}
            aria-pressed={cadence === value}
            disabled={saving}
            onClick={() => setCadence(value)}
          >
            {value === "weekly" ? "Weekly" : "Daily"}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {cadence === "weekly" && (
          <label className="space-y-1 text-xs text-muted-foreground">
            <span>Day</span>
            <Select
              value={weekday}
              onValueChange={(value) => {
                if (value !== null) setWeekday(value);
              }}
              disabled={saving}
            >
              <SelectTrigger aria-label="Check-in day">
                <SelectValue>{WEEKDAY_LABELS[Number(weekday)]}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {WEEKDAY_LABELS.map((day, index) => (
                  <SelectItem key={day} value={String(index)}>
                    {day}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </label>
        )}
        <label className="w-32 space-y-1 text-xs text-muted-foreground">
          <span>Time</span>
          <Input
            type="time"
            aria-label="Check-in time"
            value={time}
            disabled={saving}
            onChange={(event) => setTime(event.target.value)}
          />
        </label>
        <span className="pb-2 text-xs text-muted-foreground">{timezone}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        {selection
          ? `Uses ${provider?.displayName ?? selection.instanceId} · ${selection.model}. You can change the model and instructions in Bots.`
          : "Connect a model in Settings → Providers to run check-ins."}
      </p>
      {provider?.driverKind === "devReplay" && (
        <p className="text-xs text-muted-foreground">
          Replay produces recorded test responses. Choose a connected AI model in Bots for personal
          check-ins.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Reads your current plan and progress, then suggests a next step in Inbox. It runs while this
        Bara server is online.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" disabled={saving} onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={!available || !selection || saving || !time}
          onClick={() => void submit()}
        >
          {saving ? "Saving…" : "Start check-ins"}
        </Button>
      </div>
    </div>
  );
}
