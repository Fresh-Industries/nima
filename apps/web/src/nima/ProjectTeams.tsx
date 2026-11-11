import { useAtomValue } from "@effect/atom-react";
import { BotAvatar } from "./BotAvatar";
import { BotId, type EnvironmentId, type ProjectId, type ProjectTeam } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "../components/ui/dialog";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { useProjects } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { useScratchProject } from "../hooks/useScratchProject";
import { useBots } from "./useBots";

export function ProjectTeamsDialog({ onClose }: { onClose: () => void }) {
  const primary = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const [chosen, setChosen] = useState<EnvironmentId | null>(null);
  const environmentId = chosen ?? primary;
  const [projectId, setProjectId] = useState<ProjectId | null>(null);
  const scratch = useScratchProject();
  const projects = useProjects().filter(
    (project) =>
      project.environmentId === environmentId &&
      project.archivedAt == null &&
      project.workspaceRoot !== scratch.scratchWorkspaceRootFor(environmentId),
  );
  const selected = projects.find((project) => project.id === projectId) ?? projects[0];
  const query = useEnvironmentQuery(
    environmentId ? serverEnvironment.projectTeamsLive({ environmentId, input: {} }) : null,
  );
  const directory = useBots(environmentId ?? undefined);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Project teams</DialogTitle>
          <DialogDescription>
            Reuse your teammates across projects. Personal Bots and Work need no project.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="grid gap-5">
            {environments.length > 1 && (
              <label className="grid gap-2 text-sm">
                Environment
                <select
                  className="rounded-md border border-border bg-background p-2"
                  disabled={busy}
                  value={environmentId ?? ""}
                  onChange={(event) => {
                    setChosen(event.target.value as EnvironmentId);
                    setProjectId(null);
                  }}
                >
                  {environments.map((host) => (
                    <option key={host.environmentId} value={host.environmentId}>
                      {host.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="grid gap-2 text-sm">
              Project
              <select
                className="rounded-md border border-border bg-background p-2"
                value={selected?.id ?? ""}
                disabled={busy || !projects.length}
                onChange={(event) => setProjectId(event.target.value as ProjectId)}
              >
                {projects.length ? (
                  projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.title}
                    </option>
                  ))
                ) : (
                  <option value="">No projects available</option>
                )}
              </select>
            </label>
            {query.error && (
              <p role="alert" className="text-sm text-destructive">
                {query.error}
              </p>
            )}
            {directory.query.error && (
              <p role="alert" className="text-sm text-destructive">
                {directory.query.error}
              </p>
            )}
            {selected && environmentId && query.data && directory.query.data ? (
              <TeamEditor
                key={`${environmentId}:${selected.id}`}
                environmentId={environmentId}
                team={
                  query.data.teams.find((team) => team.projectId === selected.id) ?? {
                    projectId: selected.id,
                    members: [],
                    revision: 0,
                  }
                }
                directory={directory}
                onBusy={setBusy}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {projects.length
                  ? "Loading team…"
                  : "Create a project through the existing workspace controls when you need one."}
              </p>
            )}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
function TeamEditor({
  environmentId,
  team,
  directory,
  onBusy,
}: {
  environmentId: EnvironmentId;
  team: ProjectTeam;
  directory: ReturnType<typeof useBots>;
  onBusy: (busy: boolean) => void;
}) {
  const [draft, setDraft] = useState<ProjectTeam | null>(null);
  const current = draft ?? team;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const canWrite = useAtomValue(serverEnvironment.writeProjectTeam.permissionAtom(environmentId));
  const write = useAtomCommand(serverEnvironment.writeProjectTeam, { reportFailure: false });
  const disabled = saving || !canWrite || !directory.connected;
  const save = async () => {
    if (disabled) return;
    setSaving(true);
    onBusy(true);
    setError("");
    const result = await write({
      environmentId,
      input: {
        projectId: team.projectId,
        members: current.members,
        expectedRevision: current.revision,
      },
    });
    setSaving(false);
    onBusy(false);
    if (result._tag !== "Success") {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "Could not save this team.");
      return;
    }
    if (result.value.status === "conflict") {
      setError("This team changed elsewhere. Load the saved team before editing again.");
      return;
    }
    setDraft(result.value.team);
  };
  const visible = directory.bots.filter(
    (bot) => !bot.archived || current.members.some((member) => member.botId === bot.id),
  );
  return (
    <div className="grid gap-4">
      <p className="text-xs text-muted-foreground">
        Membership saves a responsibility. It grants no additional tool or resource access.
      </p>
      <div className="grid gap-3">
        {visible.map((bot) => {
          const member = current.members.find((member) => member.botId === bot.id);
          return (
            <div key={bot.id} className="grid gap-2 border-b border-border/50 pb-3">
              <label className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(member)}
                  disabled={disabled || (!member && bot.archived)}
                  onChange={(event) =>
                    setDraft({
                      ...current,
                      members: event.target.checked
                        ? [...current.members, { botId: BotId.make(bot.id), role: "" }]
                        : current.members.filter((member) => member.botId !== bot.id),
                    })
                  }
                />
                <span>
                  <BotAvatar avatar={bot.config.avatar} name={bot.config.name} seed={bot.id} />{" "}
                  {bot.config.name}
                  {bot.archived ? " · archived" : ""}
                </span>
              </label>
              {member && (
                <input
                  className="ml-6 rounded-md border border-border bg-background px-3 py-2 text-sm"
                  aria-label={`${bot.config.name} project responsibility`}
                  placeholder="Responsibility in this project (optional)"
                  maxLength={600}
                  disabled={disabled}
                  value={member.role}
                  onChange={(event) =>
                    setDraft({
                      ...current,
                      members: current.members.map((member) =>
                        member.botId === bot.id ? { ...member, role: event.target.value } : member,
                      ),
                    })
                  }
                />
              )}
            </div>
          );
        })}
      </div>
      {!visible.length && (
        <p className="text-sm text-muted-foreground">Create a Bot first, then add it here.</p>
      )}
      {current.revision !== team.revision && (
        <Button
          variant="outline"
          size="sm"
          disabled={saving}
          onClick={() => {
            setDraft(null);
            setError("");
          }}
        >
          Load saved team
        </Button>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div>
        <Button size="sm" disabled={disabled || draft === null} onClick={() => void save()}>
          {saving ? "Saving…" : "Save team"}
        </Button>
      </div>
    </div>
  );
}
