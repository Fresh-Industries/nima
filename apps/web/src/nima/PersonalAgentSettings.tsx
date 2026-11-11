import { useAtomValue } from "@effect/atom-react";
import { BotAvatar, CharacterPicker, characterFor } from "./BotAvatar";
import { Link } from "@tanstack/react-router";
import { HOME_BOT_ID } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { PersonalAgentProfile, PersonalAgentConfig } from "@t3tools/contracts";
import { useState } from "react";
import { SettingsSection } from "../components/settings/settingsLayout";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { useScheduledBots } from "../state/scheduledTasks";
import { usePersonalAssistant } from "./usePersonalAssistant";
import { PersonalMemorySettings } from "./PersonalMemorySettings";
import styles from "./nima.module.css";

export function PersonalAgentSettings() {
  const assistant = usePersonalAssistant();
  return (
    <SettingsSection id="personal-agent" title="Personal agent">
      {!assistant.profile ? (
        <p role="status">{assistant.query.error || "Connecting to your assistant…"}</p>
      ) : (
        <AssistantPreferences
          key={assistant.environmentId}
          assistant={assistant}
          profile={assistant.profile}
        />
      )}
    </SettingsSection>
  );
}
function AssistantPreferences({
  assistant,
  profile,
}: {
  assistant: ReturnType<typeof usePersonalAssistant>;
  profile: PersonalAgentProfile;
}) {
  const [draft, setDraft] = useState<PersonalAgentConfig>(profile.config);
  const [base, setBase] = useState(profile.revision);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<PersonalAgentProfile | null>(null);
  const canWrite = useAtomValue(
    serverEnvironment.writePersonalAgent.permissionAtom(assistant.environmentId),
  );
  const write = useAtomCommand(serverEnvironment.writePersonalAgent, { reportFailure: false });
  const { bots } = useScheduledBots();
  const remote = conflict ?? profile;
  const changed = remote.revision !== base;
  const disabled = !canWrite || !assistant.connected || busy;
  const save = async (expectedRevision = base) => {
    if (!assistant.environmentId || disabled) return;
    setBusy(true);
    setStatus("");
    const result = await write({
      environmentId: assistant.environmentId,
      input: { config: draft, expectedRevision },
    });
    setBusy(false);
    if (result._tag !== "Success") {
      const cause = squashAtomCommandFailure(result);
      setStatus(cause instanceof Error ? cause.message : "Could not save settings.");
      return;
    }
    if (result.value.status === "conflict") {
      setConflict(result.value.profile);
      setStatus("Settings changed in another browser. Your edits are kept.");
      return;
    }
    setBase(result.value.profile.revision);
    setConflict(null);
    setStatus("Personal agent settings saved on your Bara server.");
  };
  return (
    <div className="space-y-8">
      <form
        className={styles["nima-personal-settings"]}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <p>
          Shared by browsers paired to your primary Bara server. Choose the model in the
          conversation.
        </p>
        <label>
          Assistant name
          <Input
            value={draft.name}
            maxLength={80}
            disabled={disabled}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </label>
        <CharacterPicker
          value={draft.avatar}
          onChange={(avatar) => setDraft({ ...draft, avatar })}
          disabled={disabled}
        />
        <label>
          Emoji or text avatar instead
          <Input
            value={characterFor(draft.avatar) ? "" : draft.avatar}
            maxLength={32}
            disabled={disabled}
            onChange={(event) => setDraft({ ...draft, avatar: event.target.value })}
          />
        </label>
        <label>
          Timezone
          <Input
            value={draft.timezone}
            disabled={disabled}
            onChange={(event) => setDraft({ ...draft, timezone: event.target.value })}
          />
        </label>
        <label>
          Reasoning
          <select
            value={draft.reasoning}
            disabled={disabled}
            onChange={(event) =>
              setDraft({
                ...draft,
                reasoning: event.target.value as PersonalAgentConfig["reasoning"],
              })
            }
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="xhigh">Extra High</option>
          </select>
        </label>
        <label>
          Assistant instructions
          <Textarea
            value={draft.instructions}
            maxLength={4000}
            disabled={disabled}
            placeholder="How would you like your assistant to help you?"
            onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
          />
        </label>
        <fieldset disabled={disabled} className="space-y-3">
          <legend className="mb-2 text-sm font-medium">
            Routines allowed to use personal memory
          </legend>
          <p className="text-xs text-muted-foreground">
            Other Bots and coding threads do not receive your personal facts. Project and thread
            facts stay within their resources.
          </p>
          {bots
            .filter((bot) => bot.environmentId === assistant.environmentId)
            .map(({ task }) => (
              <label key={task.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.personalMemoryTaskIds.includes(task.id)}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      personalMemoryTaskIds: event.target.checked
                        ? [...draft.personalMemoryTaskIds, task.id]
                        : draft.personalMemoryTaskIds.filter((id) => id !== task.id),
                    })
                  }
                />
                {task.title}
              </label>
            ))}
          {draft.personalMemoryTaskIds
            .filter(
              (id) =>
                !bots.some(
                  (bot) => bot.environmentId === assistant.environmentId && bot.task.id === id,
                ),
            )
            .map((id) => (
              <label key={id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked
                  onChange={() =>
                    setDraft({
                      ...draft,
                      personalMemoryTaskIds: draft.personalMemoryTaskIds.filter(
                        (value) => value !== id,
                      ),
                    })
                  }
                />
                Unavailable routine · remove access
              </label>
            ))}
        </fieldset>
        {changed && (
          <div role="alert" className="space-y-3 rounded-lg border border-border p-3 text-sm">
            <p>The server has newer settings. Your unsaved edits are kept.</p>
            <details>
              <summary>Server settings</summary>
              <p>
                {remote.config.name} ·{" "}
                <BotAvatar avatar={remote.config.avatar} name={remote.config.name} /> ·{" "}
                {remote.config.timezone} · {remote.config.reasoning}
              </p>
              <p className="whitespace-pre-wrap">
                {remote.config.instructions || "No custom instructions"}
              </p>
              <p>
                Personal-memory access:{" "}
                {remote.config.personalMemoryTaskIds
                  .map(
                    (id) =>
                      bots.find(
                        (bot) =>
                          bot.environmentId === assistant.environmentId && bot.task.id === id,
                      )?.task.title ?? id,
                  )
                  .join(", ") || "No Bots"}
              </p>
            </details>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setDraft(remote.config);
                  setBase(remote.revision);
                  setConflict(null);
                  setStatus("");
                }}
              >
                Use server settings
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={disabled}
                onClick={() => void save(remote.revision)}
              >
                Save my settings
              </Button>
            </div>
          </div>
        )}
        <div>
          <Button type="submit" size="sm" disabled={disabled || changed}>
            {busy ? "Saving…" : "Save preferences"}
          </Button>
        </div>
        <p role="status">{status}</p>
      </form>
      {assistant.environmentId && (
        <Link
          to="/bots"
          search={{ environmentId: assistant.environmentId, botId: HOME_BOT_ID, view: "routines" }}
          className="text-sm text-muted-foreground"
        >
          Assistant routines →
        </Link>
      )}
      {assistant.environmentId && (
        <PersonalMemorySettings
          environmentId={assistant.environmentId}
          connected={assistant.connected}
        />
      )}
    </div>
  );
}
