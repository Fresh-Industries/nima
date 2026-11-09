import {
  DEFAULT_BOT_CAPABILITIES,
  type BotCapabilities,
  type BotConfiguration,
  type BotToolGroup,
  type EnvironmentId,
} from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { useProjects } from "../state/entities";
import { useEnvironmentProviders } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";
import { Input } from "../components/ui/input";

const groups: { id: BotToolGroup; label: string }[] = [
  { id: "knowledge", label: "Memory, Notes, Library and Goals" },
  { id: "work", label: "Work, Bots and routines" },
  { id: "browser", label: "Browser and devices" },
  { id: "studio", label: "Studio and HTML" },
  { id: "environment", label: "Projects, worktrees and environment" },
];
export function BotCapabilitiesSettings({
  config,
  environmentId,
  disabled,
  onChange,
}: {
  config: BotConfiguration;
  environmentId: EnvironmentId;
  disabled: boolean;
  onChange: (capabilities: BotCapabilities) => void;
}) {
  const capabilities = config.capabilities ?? DEFAULT_BOT_CAPABILITIES;
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const pages = useEnvironmentQuery(
    serverEnvironment.workspacePagesLive({ environmentId, input: {} }),
  );
  const providers = useEnvironmentProviders().get(environmentId) ?? [];
  const models = providers
    .filter((provider) => provider.enabled)
    .flatMap((provider) =>
      provider.models.map((model) => ({
        key: `${provider.instanceId}:${model.slug}`,
        label: `${provider.displayName ?? provider.driver} · ${model.slug}`,
        selection: { instanceId: provider.instanceId, model: model.slug },
      })),
    );
  const change = (patch: Partial<BotCapabilities>) => onChange({ ...capabilities, ...patch });
  return (
    <div className="space-y-5 border-t border-border pt-5">
      <details className="space-y-3">
        <summary className="cursor-pointer text-sm">Tool and resource rules</summary>
        <p className="text-xs text-muted-foreground">
          Rules further restrict Bara tools. They cannot increase main access or a coordinating
          Bot’s permissions. Approval appears in Inbox for one exact retry.
        </p>
        {groups.map((group) => (
          <label key={group.id} className="grid gap-2 text-sm">
            {group.label}
            <select
              className="rounded-md border border-border bg-background px-3 py-2"
              disabled={disabled}
              value={
                capabilities.toolPolicy.rules.find((rule) => rule.group === group.id)?.access ??
                "inherit"
              }
              onChange={(event) => {
                const access = event.target.value;
                const rules = capabilities.toolPolicy.rules.filter(
                  (rule) => rule.group !== group.id,
                );
                if (
                  access === "allowed" ||
                  access === "read-only" ||
                  access === "approval" ||
                  access === "blocked"
                )
                  rules.push({ group: group.id, access });
                change({ toolPolicy: { ...capabilities.toolPolicy, rules } });
              }}
            >
              <option value="inherit">Use main access setting</option>
              <option value="read-only">Read only</option>
              <option value="approval">Ask before changes</option>
              <option value="blocked">Blocked</option>
            </select>
          </label>
        ))}
        <label className="grid gap-2 text-sm">
          Project resources
          <select
            className="rounded-md border border-border bg-background px-3 py-2"
            disabled={disabled}
            value={capabilities.toolPolicy.projectIds === null ? "all" : "selected"}
            onChange={(event) =>
              change({
                toolPolicy: {
                  ...capabilities.toolPolicy,
                  projectIds: event.target.value === "all" ? null : [],
                },
              })
            }
          >
            <option value="all">Existing project permissions</option>
            <option value="selected">Only selected projects</option>
          </select>
        </label>
        {capabilities.toolPolicy.projectIds !== null && (
          <fieldset className="space-y-2 text-sm">
            <legend className="mb-2 text-xs text-muted-foreground">
              Personal conversations remain available. Shared documents use the knowledge rule.
              Broad project discovery and linked-host requests are refused.
            </legend>
            {projects.map((project) => (
              <label key={project.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={capabilities.toolPolicy.projectIds!.includes(project.id)}
                  onChange={(event) =>
                    change({
                      toolPolicy: {
                        ...capabilities.toolPolicy,
                        projectIds: event.target.checked
                          ? [...capabilities.toolPolicy.projectIds!, project.id]
                          : capabilities.toolPolicy.projectIds!.filter((id) => id !== project.id),
                      },
                    })
                  }
                />
                {project.title}
              </label>
            ))}
          </fieldset>
        )}
      </details>
      <details className="space-y-3">
        <summary className="cursor-pointer text-sm">Reusable skills</summary>
        <p className="text-xs text-muted-foreground">
          Choose Library documents as shared procedures. Turns receive current titles and excerpts;
          full documents use existing Library permissions. Archive or unassign to remove a skill.
        </p>
        <Link to="/spaces" className="text-xs text-muted-foreground">
          Write or edit a procedure in Library →
        </Link>
        {(pages.data?.pages ?? []).map((page) => (
          <label key={page.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              disabled={
                disabled ||
                (!capabilities.skillPageIds.includes(page.id) &&
                  capabilities.skillPageIds.length >= 8)
              }
              checked={capabilities.skillPageIds.includes(page.id)}
              onChange={(event) =>
                change({
                  skillPageIds: event.target.checked
                    ? [...capabilities.skillPageIds, page.id]
                    : capabilities.skillPageIds.filter((id) => id !== page.id),
                })
              }
            />
            {page.title}
          </label>
        ))}
        {capabilities.skillPageIds
          .filter((id) => !pages.data?.pages.some((page) => page.id === id))
          .map((id) => (
            <label key={id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked
                disabled={disabled}
                onChange={() =>
                  change({
                    skillPageIds: capabilities.skillPageIds.filter((value) => value !== id),
                  })
                }
              />
              Assigned document · {id}
            </label>
          ))}
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            disabled={disabled}
            checked={capabilities.recallRelationship}
            onChange={(event) => change({ recallRelationship: event.target.checked })}
          />
          Recall relevant messages from this Bot’s relationship during Work. Other Work
          conversations are excluded.
        </label>
      </details>
      <details className="space-y-3">
        <summary className="cursor-pointer text-sm">Execution safeguards</summary>
        <p className="text-xs text-muted-foreground">
          Fallbacks apply before execution when the selected provider is unavailable. Failed actions
          are not automatically repeated.
        </p>
        {[0, 1, 2].map((index) => {
          const selected = capabilities.fallbackModels[index],
            key = selected ? `${selected.instanceId}:${selected.model}` : "";
          return (
            <label key={index} className="grid gap-2 text-sm">
              Fallback model {index + 1}
              <select
                className="rounded-md border border-border bg-background px-3 py-2"
                disabled={disabled}
                value={key}
                onChange={(event) => {
                  const model = models.find((model) => model.key === event.target.value)?.selection,
                    fallbackModels = [...capabilities.fallbackModels];
                  if (model) fallbackModels[index] = model;
                  else fallbackModels.splice(index, 1);
                  change({ fallbackModels: fallbackModels.filter(Boolean) });
                }}
              >
                <option value="">None</option>
                {key && !models.some((model) => model.key === key) && (
                  <option value={key}>{selected?.model} (unavailable)</option>
                )}
                {models.map((model) => (
                  <option key={model.key} value={model.key}>
                    {model.label}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
        <label className="grid gap-2 text-sm">
          Maximum run minutes
          <Input
            type="number"
            min={1}
            max={240}
            disabled={disabled}
            value={capabilities.maxRunMinutes ?? ""}
            placeholder="No additional limit"
            onChange={(event) =>
              change({ maxRunMinutes: event.target.value ? Number(event.target.value) : null })
            }
          />
        </label>
        <label className="grid gap-2 text-sm">
          Reported conversation token limit
          <Input
            type="number"
            min={1000}
            max={10000000}
            disabled={disabled}
            value={capabilities.maxReportedTokens ?? ""}
            placeholder="No additional limit"
            onChange={(event) =>
              change({ maxReportedTokens: event.target.value ? Number(event.target.value) : null })
            }
          />
        </label>
        <label className="grid gap-2 text-sm">
          Reported conversation spend limit (USD)
          <Input
            type="number"
            min={0.01}
            max={10000}
            step={0.01}
            disabled={disabled}
            value={capabilities.maxReportedCostUsd ?? ""}
            placeholder="No additional limit"
            onChange={(event) =>
              change({ maxReportedCostUsd: event.target.value ? Number(event.target.value) : null })
            }
          />
        </label>
        <label className="grid gap-2 text-sm">
          Provider preparation retries
          <select
            className="rounded-md border border-border bg-background px-3 py-2"
            disabled={disabled}
            value={capabilities.maxPreparationRetries ?? 0}
            onChange={(event) => change({ maxPreparationRetries: Number(event.target.value) })}
          >
            <option value={0}>None</option>
            <option value={1}>One</option>
            <option value={2}>Two</option>
          </select>
        </label>
        <p className="text-xs text-muted-foreground">
          Limits are checked by the backend about every five seconds. Token and USD stops include
          earlier usage in this provider conversation, depend on provider reports and can overshoot.
          Missing reports cannot enforce those stops. These are not hard provider billing caps.
          Retries cover transient connection failures while preparing a provider thread; submitted
          prompts and actions are never automatically repeated.
        </p>
      </details>
    </div>
  );
}
