import { usePersonalAssistant } from "./usePersonalAssistant";
import { useOpenAssistant } from "./useAssistantThread";
import type { EnvironmentId } from "@t3tools/contracts";
import { GoalCheckins } from "./GoalCheckins";
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Building2,
  Circle,
  DollarSign,
  Heart,
  Laptop,
  MessageCircle,
  MoreHorizontal,
  MoreVertical,
  Palette,
  Plus,
  Target,
  Users,
} from "lucide-react";
import ChatMarkdown from "../components/ChatMarkdown";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../components/ui/menu";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";
import { goalHasConflict, goalIsDirty, goalSummary, type GoalDraft } from "./goalWorkspace";
import { goalConversationPrompt } from "./goalConversation";
import { useConversationHandoffStore } from "./conversationHandoffStore";
import { useWorkspaceGoals } from "./useWorkspaceGoals";
import styles from "./nima.module.css";
import formStyles from "./BriefForm.module.css";

type Controller = ReturnType<typeof useWorkspaceGoals>;
type View = "active" | "completed" | "archived";
const CATEGORIES = [
  { name: "Health", icon: Heart },
  { name: "Relationships", icon: Users },
  { name: "Finance", icon: DollarSign },
  { name: "Career", icon: Building2 },
  { name: "Interests", icon: Palette },
  { name: "Productivity", icon: Laptop },
  { name: "Something else", icon: Target },
] as const;

export function Goals({
  goalId,
  environmentId,
}: {
  goalId?: string;
  environmentId?: EnvironmentId;
}) {
  const goals = useWorkspaceGoals(environmentId);
  const navigate = useNavigate();
  const [view, setView] = useState<View>("active");
  const [newGoal, setNewGoal] = useState("");
  const [detailId, setDetailId] = useState<string | null>(goalId ?? null);
  const [previousGoalId, setPreviousGoalId] = useState(goalId);
  if (previousGoalId !== goalId) {
    setPreviousGoalId(goalId);
    setDetailId(goalId ?? null);
  }
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const entries = Object.entries(goals.drafts).filter(([, { content }]) =>
    view === "active"
      ? content.status === "active" || content.status === "paused"
      : content.status === view,
  );
  const detail = detailId ? goals.drafts[detailId] : undefined;
  const openAssistant = useOpenAssistant();
  const beginConversation = async (prompt: string) => {
    setOpening(true);
    setOpenError(null);
    useConversationHandoffStore.getState().begin(prompt);
    try {
      await openAssistant();
    } catch {
      const request = useConversationHandoffStore.getState().request;
      if (request?.prompt === prompt) useConversationHandoffStore.getState().dismiss(request.id);
      setOpenError("Your conversation couldn’t open. Please try again.");
    }
    setOpening(false);
  };
  const updateStatus = (id: string, status: GoalDraft["content"]["status"]) => {
    goals.edit(id, (content) => ({ ...content, status }));
    void goals.save(id);
  };
  const startGoal = (category: string | null) =>
    void beginConversation(
      [goalConversationPrompt(category), newGoal.trim()].filter(Boolean).join("\n\n"),
    );
  const discuss = (id: string, draft: GoalDraft) =>
    void beginConversation(
      `I'd like to check in on my goal “${draft.content.title}”. Read saved goal ${JSON.stringify(id)} on environment ${goals.environmentId} for current context, and help me work out the next useful step.`,
    );
  return (
    <main className={styles["nima-page"]}>
      <div className={styles["bara-goals-simple"]}>
        <header className={styles["bara-goals-header"]}>
          <div>
            <h1>
              {view === "active"
                ? "Goals"
                : view === "completed"
                  ? "Completed goals"
                  : "Archived goals"}
            </h1>
          </div>
          <Menu>
            <MenuTrigger aria-label="Goals options" render={<Button variant="ghost" size="icon" />}>
              <MoreHorizontal size={19} />
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem onClick={() => setView("active")}>Active goals</MenuItem>
              <MenuItem onClick={() => setView("completed")}>Completed goals</MenuItem>
              <MenuItem onClick={() => setView("archived")}>Archived goals</MenuItem>
            </MenuPopup>
          </Menu>
        </header>
        {goals.error && (
          <p className={styles["bara-goals-notice"]} role="alert">
            {goals.error} <button onClick={goals.refresh}>Retry connection</button>
          </p>
        )}
        {!goals.connected && (
          <p className={styles["bara-goals-notice"]} role="status">
            {goals.environmentId
              ? "Offline. Your saved goals are still here."
              : "Connect to Bara to see your saved goals."}
          </p>
        )}
        {goals.loading && (
          <p className={styles["bara-goals-notice"]} role="status">
            Loading goals…
          </p>
        )}
        {(["tracking", "goal"] as const).map((kind) => {
          const group = entries.filter(([, draft]) => draft.content.kind === kind);
          if (!group.length) return null;
          return (
            <section
              key={kind}
              className={styles["bara-goals-section"]}
              aria-label={kind === "tracking" ? "Tracking" : "Goals"}
            >
              <h2 data-kind={kind}>
                <Circle size={9} fill="currentColor" strokeWidth={0} aria-hidden="true" />
                {kind === "tracking" ? "Tracking" : "Goals"}
              </h2>
              {group.map(([id, draft]) => (
                <article className={styles["bara-goal-simple-row"]} key={id}>
                  <div className={styles["bara-goal-check"]}>
                    <Checkbox
                      aria-label={`${draft.content.status === "completed" ? "Reopen" : "Complete"} ${draft.content.title}`}
                      checked={draft.content.status === "completed"}
                      disabled={!goals.canEdit || draft.content.status === "archived"}
                      onCheckedChange={(checked) =>
                        updateStatus(id, checked ? "completed" : "active")
                      }
                    />
                  </div>
                  <button className={styles["bara-goal-summary"]} onClick={() => setDetailId(id)}>
                    <span>{draft.content.title}</span>
                    {(draft.remote?.latestUpdate?.text ||
                      draft.content.nextStep ||
                      draft.content.context) && <p>{goalSummary(draft)}</p>}
                    {draft.content.status === "paused" && <small>Paused</small>}
                    {goalHasConflict(draft) && (
                      <small>Changed elsewhere · review your saved draft</small>
                    )}
                    {!goalHasConflict(draft) && goalIsDirty(draft) && (
                      <small role="status">{goals.status(id)}</small>
                    )}
                  </button>
                  <Menu>
                    <MenuTrigger
                      aria-label={`Actions for ${draft.content.title}`}
                      render={<Button variant="ghost" size="icon" />}
                    >
                      <MoreVertical size={17} />
                    </MenuTrigger>
                    <MenuPopup align="end">
                      <MenuItem onClick={() => discuss(id, draft)} disabled={opening}>
                        Discuss with assistant
                      </MenuItem>
                      <MenuItem onClick={() => setDetailId(id)}>View details</MenuItem>
                      {draft.content.status === "active" && (
                        <MenuItem
                          onClick={() => updateStatus(id, "paused")}
                          disabled={!goals.canEdit}
                        >
                          Pause goal
                        </MenuItem>
                      )}
                      {draft.content.status === "paused" && (
                        <MenuItem
                          onClick={() => updateStatus(id, "active")}
                          disabled={!goals.canEdit}
                        >
                          Resume goal
                        </MenuItem>
                      )}
                      {draft.content.status === "completed" && (
                        <MenuItem
                          onClick={() => updateStatus(id, "active")}
                          disabled={!goals.canEdit}
                        >
                          Reopen goal
                        </MenuItem>
                      )}
                      <MenuItem
                        disabled={!goals.canEdit}
                        onClick={() => {
                          goals.edit(id, (content) => ({
                            ...content,
                            kind: content.kind === "tracking" ? "goal" : "tracking",
                          }));
                          void goals.save(id);
                        }}
                      >
                        {draft.content.kind === "tracking" ? "Move to Goals" : "Move to Tracking"}
                      </MenuItem>
                      {draft.content.status === "archived" ? (
                        <MenuItem
                          onClick={() => updateStatus(id, "active")}
                          disabled={!goals.canEdit}
                        >
                          Restore goal
                        </MenuItem>
                      ) : (
                        <MenuItem
                          onClick={() => updateStatus(id, "archived")}
                          disabled={!goals.canEdit}
                        >
                          Archive goal
                        </MenuItem>
                      )}
                    </MenuPopup>
                  </Menu>
                </article>
              ))}
            </section>
          );
        })}
        {!entries.length && !goals.loading && view !== "active" && (
          <p className={styles["bara-goals-empty-copy"]}>
            {view === "completed" ? "No completed goals" : "No archived goals"}
          </p>
        )}
        {view === "active" && (
          <section className={styles["bara-goal-start"]} aria-label="Start a goal">
            <form
              className={formStyles.quickEntry}
              onSubmit={(event) => {
                event.preventDefault();
                if (goals.add(newGoal)) setNewGoal("");
              }}
            >
              <input
                aria-label="New goal"
                placeholder="Add a goal"
                value={newGoal}
                maxLength={200}
                disabled={!goals.canEdit}
                onChange={(event) => setNewGoal(event.target.value)}
              />
              <button
                type="submit"
                aria-label="Add goal"
                disabled={!goals.canEdit || !newGoal.trim()}
              >
                <Plus size={18} strokeWidth={1.5} />
              </button>
            </form>
            {goals.creationUnavailableReason && (
              <p className="mt-2 text-xs text-muted-foreground" role="status">
                {goals.creationUnavailableReason}
              </p>
            )}
            <div className={formStyles.options}>
              <button disabled={opening} onClick={() => startGoal(null)}>
                <MessageCircle size={16} strokeWidth={1.5} />
                Plan in chat
              </button>
              <Menu>
                <MenuTrigger render={<button disabled={opening}>Goal ideas</button>} />
                <MenuPopup>
                  {CATEGORIES.map(({ name, icon: Icon }) => (
                    <MenuItem
                      key={name}
                      onClick={() => startGoal(name === "Something else" ? null : name)}
                    >
                      <Icon size={16} strokeWidth={1.5} />
                      {name}
                    </MenuItem>
                  ))}
                </MenuPopup>
              </Menu>
            </div>
          </section>
        )}
        {openError && (
          <p role="alert" className={styles["bara-goals-notice"]}>
            {openError}
          </p>
        )}
      </div>
      {detailId && detail && (
        <GoalDetails
          key={`${goals.environmentId}:${detailId}`}
          id={detailId}
          draft={detail}
          controller={goals}
          onClose={() => {
            setDetailId(null);
            if (goalId)
              void navigate({
                to: "/goals",
                search: environmentId ? { environmentId } : {},
                replace: true,
              });
          }}
          onDiscuss={() => discuss(detailId, detail)}
        />
      )}
    </main>
  );
}

function GoalDetails({
  id,
  draft,
  controller,
  onClose,
  onDiscuss,
}: {
  id: string;
  draft: GoalDraft;
  controller: Controller;
  onClose: () => void;
  onDiscuss: () => void;
}) {
  const {
    config: { timezone },
  } = usePersonalAssistant();
  const [beforeSequence, setBeforeSequence] = useState<number | undefined>();
  const history = useEnvironmentQuery(
    controller.environmentId && draft.remote
      ? serverEnvironment.workspaceGoalHistory({
          environmentId: controller.environmentId,
          input: { id, ...(beforeSequence === undefined ? {} : { beforeSequence }) },
        })
      : null,
  );
  const refresh = history.refresh;
  const latest = draft.remote?.latestUpdate?.id;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- refreshes visible progress when the server stream reports a newly committed update
  useEffect(() => {
    if (latest && beforeSequence === undefined) refresh();
  }, [latest, beforeSequence, refresh]);
  const content = draft.content;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{content.title}</DialogTitle>
          <DialogDescription>
            {content.kind === "tracking"
              ? "Something you’re keeping an eye on."
              : "Something you’re working toward."}
          </DialogDescription>
        </DialogHeader>
        <div className={styles["bara-goal-readout"]}>
          {controller.environmentId && draft.remote && (
            <GoalCheckins
              environmentId={controller.environmentId}
              goal={draft.remote}
              canSetup={!goalIsDirty(draft) && !goalHasConflict(draft)}
            />
          )}
          {content.context && (
            <ChatMarkdown text={content.context} cwd={undefined} parseRawHtml={false} />
          )}
          {content.nextStep && (
            <section>
              <h3>Next step</h3>
              <p>{content.nextStep}</p>
            </section>
          )}
          {content.targetDate && (
            <p className="text-xs text-muted-foreground">Target: {content.targetDate}</p>
          )}
          {content.plan && (
            <section>
              <h3>Plan</h3>
              <ChatMarkdown text={content.plan} cwd={undefined} parseRawHtml={false} />
            </section>
          )}
          {content.milestones.length > 0 && (
            <section>
              <h3>Milestones</h3>
              {content.milestones.map((item) => (
                <label key={item.id} className={styles["bara-goal-readout-milestone"]}>
                  <Checkbox
                    checked={item.done}
                    disabled={!controller.canEdit}
                    onCheckedChange={(checked) => {
                      controller.edit(id, (previous) => ({
                        ...previous,
                        milestones: previous.milestones.map((entry) =>
                          entry.id === item.id ? { ...entry, done: checked } : entry,
                        ),
                      }));
                      void controller.save(id);
                    }}
                  />
                  <span>{item.title}</span>
                </label>
              ))}
            </section>
          )}
          {history.data && history.data.updates.length > 0 && (
            <section>
              <h3>Progress</h3>
              {history.data.updates.map((update) => (
                <article key={update.id} className={styles["bara-goal-readout-update"]}>
                  <small>
                    {update.source === "user" ? "You" : "Agent"} ·{" "}
                    <time dateTime={update.createdAt}>
                      {new Intl.DateTimeFormat(undefined, {
                        month: "short",
                        day: "numeric",
                        timeZone: timezone,
                      }).format(new Date(update.createdAt))}
                    </time>
                  </small>
                  <ChatMarkdown text={update.text} cwd={undefined} parseRawHtml={false} />
                </article>
              ))}
            </section>
          )}
          {history.error && (
            <p role="alert">
              {history.error} <button onClick={refresh}>Retry</button>
            </p>
          )}
          {(beforeSequence !== undefined || history.data?.nextBeforeSequence != null) && (
            <div className="flex gap-3">
              {beforeSequence !== undefined && (
                <Button size="xs" variant="ghost" onClick={() => setBeforeSequence(undefined)}>
                  Latest updates
                </Button>
              )}
              {history.data?.nextBeforeSequence != null && (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => setBeforeSequence(history.data!.nextBeforeSequence!)}
                >
                  Older updates
                </Button>
              )}
            </div>
          )}
          {draft.progressText && (
            <section>
              <h3>Your unsent update</h3>
              <p>{draft.progressText}</p>
            </section>
          )}
          {goalHasConflict(draft) && (
            <section role="alert">
              <h3>Your draft changed elsewhere</h3>
              <p>Your local changes are kept.</p>
              <details>
                <summary>View saved version</summary>
                <ChatMarkdown
                  text={[
                    draft.remote?.content.title,
                    draft.remote?.content.context,
                    draft.remote?.content.nextStep,
                    draft.remote?.content.plan,
                  ]
                    .filter(Boolean)
                    .join("\n\n")}
                  cwd={undefined}
                  parseRawHtml={false}
                />
              </details>
              <div className="mt-3 flex gap-2">
                <Button size="xs" variant="outline" onClick={() => controller.resolve(id, true)}>
                  Use saved version
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!controller.canEdit}
                  onClick={() => controller.resolve(id, false)}
                >
                  Keep my draft
                </Button>
              </div>
            </section>
          )}
        </div>
        <DialogFooter variant="bare">
          <Button onClick={onDiscuss}>
            <MessageCircle size={16} />
            Discuss with assistant
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
