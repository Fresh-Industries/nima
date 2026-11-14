import { ScheduledTaskId } from "@t3tools/contracts";

/** The one routine behind the Assistant's daily brief. A fixed id keeps it a single routine. */
export const DAILY_BRIEF_TASK_ID = ScheduledTaskId.make("assistant-daily-brief");
export const DAILY_BRIEF_TITLE = "Daily brief";
/** The fence the Assistant writes a proposed work session in; the chat shows it as a card. */
export const PROPOSAL_FENCE = "bara-proposal";

export type WorkProposal = { title: string; objective: string; bot: string; goal: string };

/** Reads one proposal. Null while it is still being written or when it is not a proposal. */
export function parseWorkProposal(code: string): WorkProposal | null {
  try {
    const value = JSON.parse(code) as Record<string, unknown>;
    const text = (key: string) => (typeof value[key] === "string" ? value[key].trim() : "");
    if (!text("title") || !text("objective")) return null;
    return {
      title: text("title").slice(0, 120),
      objective: text("objective").slice(0, 4000),
      bot: text("bot"),
      goal: text("goal"),
    };
  } catch {
    return null;
  }
}

/** What the Assistant is asked each morning. Model-facing text. */
export const DAILY_BRIEF_PROMPT = `This is your daily brief for me. You are starting this conversation yourself; I did not ask.

First gather facts with your tools. Do not guess:
1. My goals: list them with t3_goals_list, then read each active goal and its recent history.
2. My recent work: list recent conversations with t3_thread_list and read the ones updated since your last brief (or in the last two days) closely enough to know what happened in each.
3. What is waiting on me: finished work not yet reviewed, and anything asking for my input or approval.
If a tool is unavailable, say which facts you could not read instead of inventing them.

Then write the brief. Keep it short enough to read in under a minute:
- **Moved**: what actually progressed, each tied to the goal it serves when there is one.
- **Stuck or waiting on you**: what needs my reply, review or decision, most urgent first.
- **Goals going quiet**: any active goal with no recorded progress in three or more days, with one realistic next step.
- **Today**: at most three things worth doing, in priority order.
Leave out a heading that has nothing under it. Separate recorded facts from your suggestions.

For each thing in Today that is real work an agent can carry out, propose a work session. Write each proposal as its own fenced block, exactly like this, with valid JSON on one line:

\`\`\`${PROPOSAL_FENCE}
{"title":"Short session name","objective":"What done looks like, with the context the session needs","bot":"Name of the Bot best suited, or empty","goal":"Title of the goal it serves, or empty"}
\`\`\`

I start a proposal with one click, so each objective must stand on its own. Do not start sessions, delegate work, create schedules, or mark goal milestones yourself: propose, and wait for me. If there is nothing worth proposing, say so in one line.`;
