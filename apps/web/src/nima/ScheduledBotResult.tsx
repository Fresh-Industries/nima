import { Link } from "@tanstack/react-router";
import { ScheduledTaskId, type EnvironmentId } from "@t3tools/contracts";
import { Bot } from "lucide-react";
import type { ReactNode } from "react";
import {
  scheduleLabel,
  ScheduledRelativeLabel,
} from "../components/settings/scheduledTaskPresentation";
import { Button } from "../components/ui/button";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";

export function ScheduledBotResult({
  environmentId,
  taskId,
  updated,
  fallback,
}: {
  environmentId: EnvironmentId;
  taskId: string;
  updated: boolean;
  fallback: ReactNode;
}) {
  const query = useEnvironmentQuery(
    serverEnvironment.scheduledTasksLive({ environmentId, input: {} }),
  );
  const task = query.data?.tasks.find((entry) => entry.id === taskId);
  if (!task) return fallback;
  const resultTitle = `${task.ownerBotId ? "Routine" : "Scheduled task"} ${updated ? "updated" : "created"}`;
  return (
    <section
      aria-label={resultTitle}
      className="my-2 space-y-3 rounded-xl border border-border/60 p-3 text-sm"
    >
      <div className="flex items-center gap-2">
        <Bot size={16} className="text-muted-foreground" />
        <span className="font-medium">{resultTitle}</span>
      </div>
      <div className="space-y-1">
        <p className="break-words font-medium">{task.title}</p>
        <p className="text-xs text-muted-foreground">
          {scheduleLabel(task.schedule)}
          {task.schedule.type === "fixed_time" && !task.schedule.timeZone
            ? " (host time)"
            : ""} ·{" "}
          {task.blockedByPolicy ? (
            task.blockedByPolicy
          ) : !task.enabled ? (
            "Paused"
          ) : task.nextRunAt ? (
            <>
              Next run <ScheduledRelativeLabel value={task.nextRunAt} />
            </>
          ) : task.schedule.type === "webhook" ? (
            "Listening"
          ) : (
            "No next run scheduled"
          )}
        </p>
      </div>
      {task.nextRunAt && (
        <p className="text-xs text-muted-foreground">
          <time dateTime={task.nextRunAt}>
            {new Date(task.nextRunAt).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
              timeZoneName: "short",
            })}
          </time>
        </p>
      )}
      <div>
        <Button
          size="xs"
          variant="outline"
          render={
            <Link
              to="/bots"
              search={{
                environmentId,
                taskId: ScheduledTaskId.make(taskId),
                ...(task.ownerBotId ? { botId: task.ownerBotId, view: "routines" } : {}),
              }}
            />
          }
        >
          Open routine
        </Button>
      </div>
    </section>
  );
}
