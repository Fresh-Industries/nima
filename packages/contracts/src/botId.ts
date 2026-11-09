import * as Schema from "effect/Schema";

export const BotId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)).pipe(
  Schema.brand("BotId"),
);
export type BotId = typeof BotId.Type;
export const HOME_BOT_ID = BotId.make("primary");
