import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";

const transient = (failure: unknown): boolean => {
  let current = failure;
  for (let depth = 0; depth < 8 && typeof current === "object" && current !== null; depth++) {
    if (
      "code" in current &&
      ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ECONNREFUSED"].includes(String(current.code))
    )
      return true;
    current = "cause" in current ? current.cause : null;
  }
  return false;
};
/** Only wraps session preparation, never submitting a prompt or executing a tool. */
export const retryProviderPreparation = Effect.fn("BotExecution.retryProviderPreparation")(
  <A, E, R>(operation: Effect.Effect<A, E, R>, attempts: number) =>
    operation.pipe(
      Effect.retry({
        times: Math.min(2, Math.max(0, attempts)),
        while: transient,
        schedule: Schedule.exponential("500 millis"),
      }),
    ),
);
