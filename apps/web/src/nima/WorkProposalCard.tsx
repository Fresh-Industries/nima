import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { HOME_BOT_ID, type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowUpRight, Pencil, X } from "lucide-react";
import { useRef, useState } from "react";
import { useComposerDraftStore } from "../composerDraftStore";
import { newThreadId } from "../lib/utils";
import { usePrimaryEnvironmentId } from "../state/environments";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { parseWorkProposal } from "./workProposal";
import { BotAvatar } from "./BotAvatar";
import { useBots } from "./useBots";
import styles from "./WorkProposalCard.module.css";

const STORE_KEY = "bara.proposals";
type Outcome = { dismissed: true } | { environmentId: EnvironmentId; threadId: ThreadId };

function readOutcomes(): Record<string, Outcome> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") as Record<string, Outcome>;
  } catch {
    return {};
  }
}
function saveOutcome(key: string, outcome: Outcome) {
  try {
    const all = Object.entries({ ...readOutcomes(), [key]: outcome }).slice(-200);
    localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(all)));
  } catch {
    // Only remembers what this browser already did with a proposal.
  }
}

/**
 * A work session the Assistant proposes. Nothing starts until you press Start; you can change
 * the name and objective first, or dismiss it.
 */
export function WorkProposalCard({ code, streaming }: { code: string; streaming: boolean }) {
  const proposal = parseWorkProposal(code);
  const environmentId = usePrimaryEnvironmentId();
  const directory = useBots(environmentId ?? undefined);
  const canCreate = useAtomValue(serverEnvironment.createWorkSession.permissionAtom(environmentId));
  const create = useAtomCommand(serverEnvironment.createWorkSession, { reportFailure: false });
  const navigate = useNavigate();
  const key = proposal ? `${proposal.title}\n${proposal.objective}` : "";
  const [outcome, setOutcome] = useState<Outcome | undefined>(() => readOutcomes()[key]);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(proposal?.title ?? "");
  const [objective, setObjective] = useState(proposal?.objective ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef<ThreadId | null>(null);
  if (!proposal)
    return streaming ? (
      <p className={styles.pending}>Preparing a suggestion…</p>
    ) : (
      <pre>{code}</pre>
    );
  if (outcome && "dismissed" in outcome) return null;
  const bot = directory.bots.find(
    (entry) =>
      !entry.archived &&
      !entry.home &&
      entry.config.name.toLowerCase() === proposal.bot.toLowerCase(),
  );
  const decide = (next: Outcome) => {
    saveOutcome(key, next);
    setOutcome(next);
  };
  const start = async () => {
    if (!environmentId || busy || !title.trim() || !objective.trim()) return;
    setBusy(true);
    setError("");
    // A retry reuses the same id, so a slow first attempt cannot create a second session.
    const id = attempt.current ?? newThreadId();
    attempt.current = id;
    const result = await create({
      environmentId,
      input: {
        threadId: id,
        title: title.trim(),
        objective: objective.trim(),
        projectId: null,
        coordinatorBotId: bot?.id ?? HOME_BOT_ID,
      },
    });
    setBusy(false);
    if (result._tag !== "Success") {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "Could not start this session.");
      return;
    }
    const threadId = result.value.threadId;
    const ref = scopeThreadRef(environmentId, threadId);
    const drafts = useComposerDraftStore.getState();
    // The session opens with its objective ready to send, so starting stays your decision.
    if (!drafts.getComposerDraft(ref)?.prompt)
      drafts.setPrompt(ref, `${title.trim()}\n\nObjective: ${objective.trim()}`);
    decide({ environmentId, threadId });
    void navigate({ to: "/$environmentId/$threadId", params: { environmentId, threadId } });
  };
  return (
    <section className={styles.card} aria-label={`Suggested session: ${proposal.title}`}>
      <header>
        <small>Suggested session{proposal.goal ? ` · for ${proposal.goal}` : ""}</small>
        {bot && (
          <span className={styles.bot}>
            <span aria-hidden>
              <BotAvatar avatar={bot.config.avatar} name={bot.config.name} seed={bot.id} fill />
            </span>
            {bot.config.name}
          </span>
        )}
      </header>
      {editing ? (
        <>
          <input
            aria-label="Session name"
            value={title}
            maxLength={120}
            onChange={(event) => setTitle(event.target.value)}
          />
          <textarea
            aria-label="Objective"
            value={objective}
            maxLength={4000}
            rows={4}
            onChange={(event) => setObjective(event.target.value)}
          />
        </>
      ) : (
        <>
          <strong>{title}</strong>
          <p>{objective}</p>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <footer>
        {outcome && "threadId" in outcome ? (
          <Link
            to="/$environmentId/$threadId"
            params={{ environmentId: outcome.environmentId, threadId: outcome.threadId }}
            className={styles.primary}
          >
            Open session <ArrowUpRight size={14} />
          </Link>
        ) : (
          <>
            <button
              type="button"
              className={styles.primary}
              disabled={busy || !canCreate || !environmentId}
              onClick={() => void start()}
            >
              {busy ? "Starting…" : "Start"}
            </button>
            <button type="button" disabled={busy} onClick={() => setEditing(!editing)}>
              <Pencil size={13} /> {editing ? "Done" : "Edit"}
            </button>
            <button type="button" disabled={busy} onClick={() => decide({ dismissed: true })}>
              <X size={13} /> Dismiss
            </button>
          </>
        )}
      </footer>
    </section>
  );
}
