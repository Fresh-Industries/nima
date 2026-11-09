import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  HOME_BOT_ID,
  type BotId,
  type EnvironmentId,
  type MemoryScope,
  type MemoryFact,
} from "@t3tools/contracts";
import { useBots } from "./useBots";
import { useState } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { useProjects, useVisibleThreadShells } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { useEnvironmentScope } from "../state/session";
import { AuthSettingsWriteScope } from "@t3tools/contracts";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";

type Editor = { key: string; content: string; sources: MemoryFact["sources"]; revision: number };
export function PersonalMemorySettings({
  environmentId,
  connected,
  botId,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
  botId?: BotId;
}) {
  const bots = useBots(environmentId);
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const threads = useVisibleThreadShells().filter(
    (thread) => thread.environmentId === environmentId,
  );
  const scopes: { value: string; label: string; scope: MemoryScope }[] = [
    { value: "personal", label: "Personal", scope: { kind: "personal" } },
    ...bots.bots
      .filter((bot) => !bot.home)
      .map((bot) => ({
        value: `bot:${bot.id}`,
        label: `Bot · ${bot.config.name}`,
        scope: { kind: "bot" as const, botId: bot.id },
      })),
    ...projects.map((project) => ({
      value: `project:${project.id}`,
      label: `Project · ${project.title}`,
      scope: { kind: "project" as const, projectId: project.id },
    })),
    ...threads.map((thread) => ({
      value: `thread:${thread.id}`,
      label: `Thread · ${thread.title}`,
      scope: { kind: "thread" as const, threadId: thread.id },
    })),
  ];
  const [selected, setSelected] = useState(
    botId && botId !== HOME_BOT_ID ? `bot:${botId}` : "personal",
  );
  const scope = scopes.find((scope) => scope.value === selected);
  const allowed = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  return (
    <section className="space-y-4" aria-label="Assistant memory">
      <h3 className="text-sm font-semibold">Memory</h3>
      <p className="text-sm text-muted-foreground">
        Facts recalled across conversations. Corrections replace the saved fact. Forget removes its
        stored text and sources; existing conversation history is kept.
      </p>
      <label className="flex max-w-sm flex-col gap-2 text-sm">
        Resource
        <select
          className="rounded-md border border-border bg-background px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
        >
          {scopes.map((scope) => (
            <option key={scope.value} value={scope.value}>
              {scope.label}
            </option>
          ))}
        </select>
      </label>
      {!allowed ? (
        <p>Memory controls require permission to manage this server’s settings.</p>
      ) : scope ? (
        <MemoryResource
          key={`${environmentId}:${scope.value}`}
          environmentId={environmentId}
          scope={scope.scope}
          connected={connected}
        />
      ) : (
        <p>This resource is no longer available.</p>
      )}
    </section>
  );
}
function MemoryResource({
  environmentId,
  scope,
  connected,
}: {
  environmentId: EnvironmentId;
  scope: MemoryScope;
  connected: boolean;
}) {
  const query = useEnvironmentQuery(
    serverEnvironment.personalMemoriesLive({ environmentId, input: { scope } }),
  );
  const canWrite = useAtomValue(
    serverEnvironment.rememberPersonalFact.permissionAtom(environmentId),
  );
  const write = useAtomCommand(serverEnvironment.rememberPersonalFact, { reportFailure: false });
  const [editor, setEditor] = useState<Editor | null>(null);
  const [conflict, setConflict] = useState<MemoryFact | null>(null);
  const [pendingAction, setPendingAction] = useState<"remember" | "forget">("remember");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const enabled = canWrite && connected && !busy;
  const save = async (value: Editor, action: "remember" | "forget", revision = value.revision) => {
    if (!enabled) return;
    setBusy(true);
    setStatus("");
    const result = await write({
      environmentId,
      input: {
        scope,
        key: value.key,
        content: action === "forget" ? "" : value.content,
        sources: action === "forget" ? [] : value.sources,
        action,
        expectedRevision: revision,
      },
    });
    setBusy(false);
    if (result._tag !== "Success") {
      const cause = squashAtomCommandFailure(result);
      setStatus(cause instanceof Error ? cause.message : "Could not save this fact.");
      return;
    }
    if (result.value.status === "conflict") {
      setPendingAction(action);
      setEditor(value);
      setConflict(result.value.fact);
      setStatus("This fact changed. Review the current value before saving.");
      return;
    }
    setEditor(null);
    setConflict(null);
    setStatus(
      action === "forget" ? "Fact forgotten. Existing transcripts are unchanged." : "Fact saved.",
    );
  };
  const facts = query.data ? query.data.facts : [];
  return (
    <div className="space-y-4">
      <Button
        size="sm"
        variant="outline"
        disabled={!enabled}
        onClick={() => {
          setEditor({
            key: "",
            content: "",
            sources: [{ label: "Saved in settings", threadId: null, messageId: null }],
            revision: 0,
          });
          setConflict(null);
          setStatus("");
        }}
      >
        Remember a fact
      </Button>
      {editor && (
        <form
          className="space-y-3 rounded-lg border border-border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save(editor, "remember");
          }}
        >
          <label className="flex flex-col gap-2 text-sm">
            Fact key
            <Input
              value={editor.key}
              maxLength={80}
              placeholder="preferred-language"
              disabled={!enabled || editor.revision > 0}
              pattern="[a-z0-9][a-z0-9._-]{0,79}"
              required
              onChange={(event) => setEditor({ ...editor, key: event.target.value })}
            />
          </label>
          <label className="flex flex-col gap-2 text-sm">
            Fact
            <Textarea
              value={editor.content}
              maxLength={1200}
              required
              disabled={!enabled}
              onChange={(event) => setEditor({ ...editor, content: event.target.value })}
            />
          </label>
          {conflict && (
            <div role="alert" className="space-y-2 text-sm">
              <p>
                Current server revision {conflict.revision}:{" "}
                {conflict.forgotten ? "Forgotten" : conflict.content}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setEditor(
                      conflict.forgotten
                        ? null
                        : {
                            key: conflict.key,
                            content: conflict.content,
                            sources: conflict.sources,
                            revision: conflict.revision,
                          },
                    );
                    setConflict(null);
                    setStatus("");
                  }}
                >
                  Use server version
                </Button>
                <Button
                  type="button"
                  size="xs"
                  disabled={!enabled || (pendingAction === "remember" && !editor.content.trim())}
                  onClick={() => void save(editor, pendingAction, conflict.revision)}
                >
                  {pendingAction === "forget" ? "Forget current fact" : "Save my correction"}
                </Button>
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={!enabled || Boolean(conflict)}>
              Save fact
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setEditor(null);
                setConflict(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
      {(status || query.error) && (
        <p role={query.error ? "alert" : "status"} className="text-sm">
          {status || query.error}
        </p>
      )}
      {query.isPending && !query.data && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading memory…
        </p>
      )}
      <div className="divide-y divide-border">
        {facts
          .filter((fact) => !fact.forgotten)
          .map((fact) => (
            <article key={fact.key} className="space-y-2 py-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">
                  {fact.key} · revision {fact.revision}
                </span>
                <div className="flex gap-1">
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={!enabled}
                    onClick={() => {
                      setEditor({
                        key: fact.key,
                        content: fact.content,
                        sources: fact.sources,
                        revision: fact.revision,
                      });
                      setConflict(null);
                      setStatus("");
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={!enabled}
                    onClick={() =>
                      void save(
                        {
                          key: fact.key,
                          content: fact.content,
                          sources: fact.sources,
                          revision: fact.revision,
                        },
                        "forget",
                      )
                    }
                  >
                    Forget
                  </Button>
                </div>
              </div>
              <p className="whitespace-pre-wrap text-sm">{fact.content}</p>
              {fact.sources.map((source) => (
                <p
                  key={`${source.threadId}:${source.messageId}:${source.label}`}
                  className="text-xs text-muted-foreground"
                >
                  {source.threadId ? (
                    <Link
                      to="/$environmentId/$threadId"
                      params={{ environmentId, threadId: source.threadId }}
                    >
                      {source.label || "Source conversation"}
                    </Link>
                  ) : (
                    source.label
                  )}
                </p>
              ))}
            </article>
          ))}
      </div>
      {!query.isPending && !facts.some((fact) => !fact.forgotten) && (
        <p className="text-sm text-muted-foreground">No saved facts in this resource.</p>
      )}
      {facts.some((fact) => fact.forgotten) && (
        <details className="text-xs text-muted-foreground">
          <summary>Forgotten fact keys</summary>
          <p>Only keys and revision markers remain to reject stale writes.</p>
          {facts
            .filter((fact) => fact.forgotten)
            .map((fact) => (
              <p key={fact.key}>
                {fact.key} · revision {fact.revision}
              </p>
            ))}
        </details>
      )}
    </div>
  );
}
