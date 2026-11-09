import * as Schema from "effect/Schema";

const quote = Schema.encodeSync(Schema.fromJsonString(Schema.String));

export function goalCheckinPrompt(goalId: string, instructions: string): string {
  return `You are checking in on the user's saved Bara goal ${quote(goalId)}.
Read that exact goal with t3_goals_read and its recent progress with t3_goals_history before giving advice. Use the goal's current plan, milestones, next step and guidance. If it is unavailable or inactive, explain briefly and do not start work.
Give a short, friendly check-in with one realistic next step. Distinguish recorded facts from suggestions; do not invent progress or mark milestones complete. If progress is unclear, ask one easy question. Do not append a suggestion as factual progress. This result will appear in Inbox linked to the goal.
Use the existing tool permissions. If access is unavailable, say what could not be read instead of guessing. Do not create additional schedules or delegate work unless the user explicitly requested it.

User's check-in instructions:
${instructions}`;
}
