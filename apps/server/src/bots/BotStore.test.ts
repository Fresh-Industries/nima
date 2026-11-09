import { assert, it } from "@effect/vitest";
import { BotId, HOME_BOT_ID } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as BotStore from "./BotStore.ts";
import * as Sqlite from "../persistence/Sqlite.ts";

it.effect(
  "creates project-free bots idempotently, rejects stale edits, and archives without deleting history",
  () =>
    Effect.gen(function* () {
      const bots = yield* BotStore.BotStore;
      const input = { id: BotId.make("chef"), name: "Chef", description: "Help me cook" };
      const [first, retry] = yield* Effect.all([bots.create(input), bots.create(input)], {
        concurrency: "unbounded",
      });
      assert.deepEqual(first, retry);
      assert.equal((yield* bots.list()).bots.length, 2);
      const claims = yield* Effect.all(
        [bots.claimConversation(first.id), bots.claimConversation(first.id)],
        { concurrency: "unbounded" },
      );
      assert.equal(claims[0], claims[1]);
      const current = yield* bots.get(first.id);
      const writes = yield* Effect.forEach(
        ["Recipes only", "Groceries too"],
        (instructions) =>
          bots.write({
            id: first.id,
            config: { ...first.config, instructions },
            archived: false,
            expectedRevision: current.revision,
          }),
        { concurrency: "unbounded" },
      );
      assert.deepEqual(writes.map((result) => result.status).sort(), ["conflict", "saved"]);
      const latest = yield* bots.get(first.id);
      const restricted = yield* bots.write({
        id: first.id,
        config: { ...latest.config, toolAccess: "read-only" },
        archived: false,
        expectedRevision: latest.revision,
      });
      assert.equal(restricted.bot.config.toolAccess, "read-only");
      const { toolAccess: _policy, ...legacyConfig } = restricted.bot.config;
      const legacyWrite = yield* bots.write({
        id: first.id,
        config: legacyConfig,
        archived: false,
        expectedRevision: restricted.bot.revision,
      });
      assert.equal(legacyWrite.bot.config.toolAccess, "read-only");
      const archived = yield* bots.write({
        id: first.id,
        config: legacyWrite.bot.config,
        archived: true,
        expectedRevision: legacyWrite.bot.revision,
      });
      assert.equal(archived.bot.threadId, claims[0]);
      assert.equal(yield* bots.toolAccessForThread(claims[0]!), "read-only");
      assert.equal(
        (yield* bots.claimConversation(first.id).pipe(Effect.flip)).reason,
        "unavailable",
      );
      yield* bots.write({
        id: first.id,
        config: archived.bot.config,
        archived: false,
        expectedRevision: archived.bot.revision,
      });
      assert.equal(yield* bots.claimConversation(first.id), claims[0]);
      const home = yield* bots.get(HOME_BOT_ID);
      const homeThread = yield* bots.claimConversation(HOME_BOT_ID);
      const created = yield* bots.createFromAssistant(
        {
          id: BotId.make("coach"),
          name: "Coach",
          description: "Help me learn",
          instructions: "Use short exercises",
        },
        homeThread,
      );
      assert.equal(created.config.toolAccess, "read-only");
      assert.equal(
        (yield* bots.createFromAssistant(
          { id: created.id, name: "Coach", description: "Help me learn" },
          homeThread,
        )).id,
        created.id,
      );
      assert.equal(
        (yield* bots
          .createFromAssistant(
            { id: BotId.make("unapproved"), name: "No", description: "No" },
            claims[0]!,
          )
          .pipe(Effect.flip)).reason,
        "unavailable",
      );
      const edited = yield* bots.updateFromAssistant(
        {
          id: created.id,
          expectedRevision: created.revision,
          appendInstructions: "Prefer examples",
        },
        homeThread,
      );
      assert.include(edited.bot.config.instructions, "Use short exercises");
      assert.include(edited.bot.config.instructions, "Prefer examples");
      assert.equal(
        (yield* bots.updateFromAssistant(
          { id: created.id, expectedRevision: created.revision, name: "Overwrite" },
          homeThread,
        )).status,
        "conflict",
      );
      assert.equal((yield* bots.get(created.id)).config.toolAccess, "read-only");
      assert.equal(
        (yield* bots
          .write({
            id: home.id,
            config: home.config,
            archived: true,
            expectedRevision: home.revision,
          })
          .pipe(Effect.flip)).reason,
        "invalid",
      );
      assert.equal(
        (yield* bots.get(BotId.make("missing")).pipe(Effect.flip)).reason,
        "unavailable",
      );
    }).pipe(Effect.provide(BotStore.layer.pipe(Layer.provide(Sqlite.layerMemory)))),
);
