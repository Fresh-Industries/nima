import * as BotStore from "../bots/BotStore.ts";
import { BotId, HOME_BOT_ID } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  MessageId,
  ProjectId,
  ScheduledTaskId,
  ThreadId,
  type MemoryScope,
  type MemoryWriteInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as PersonalAgent from "./PersonalAgent.ts";

const memory = PersonalAgent.layer.pipe(Layer.provideMerge(Sqlite.layerMemory));
const owner = { kind: "owner" as const };
const personal = { kind: "personal" as const };
const at = "2026-11-05T12:00:00.000Z";
const seed = Effect.fn("test.seed")(function* (
  id: ThreadId,
  projectId = ProjectId.make("project-a"),
) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`INSERT OR IGNORE INTO projection_projects(project_id,title,workspace_root,scripts_json,created_at,updated_at) VALUES(${projectId},${projectId},'/tmp/personal-agent','[]',${at},${at})`;
  yield* sql`INSERT INTO orchestration_v2_projection_threads(thread_id,project_id,title,default_provider,runtime_mode,interaction_mode,created_at,updated_at,payload_json) VALUES(${id},${projectId},${id},'devReplay','full-access','default',${at},${at},'{}')`;
});
const fact = (
  scope: MemoryScope,
  key: string,
  content: string,
  expectedRevision = 0,
): MemoryWriteInput => ({ scope, key, content, expectedRevision, action: "remember", sources: [] });

it.effect(
  "reserves one canonical conversation across concurrent opens, adopts legacy data once, and protects configuration revisions",
  () =>
    Effect.gen(function* () {
      const agent = yield* PersonalAgent.PersonalAgent;
      const legacy = ThreadId.make("legacy-assistant");
      yield* seed(legacy);
      const claims = yield* Effect.all(
        [
          agent.claimConversation(legacy),
          agent.claimConversation(),
          agent.claimConversation(ThreadId.make("another")),
        ],
        { concurrency: "unbounded" },
      );
      assert.deepEqual(claims, [legacy, legacy, legacy]);
      yield* agent.markConversation();
      const profile = yield* agent.read();
      const saved = yield* agent.write({
        config: { ...profile.config, name: "Lime", timezone: "America/Chicago" },
        expectedRevision: profile.revision,
      });
      assert.equal(saved.status, "saved");
      const stale = yield* agent.write({
        config: { ...profile.config, name: "Stale browser" },
        expectedRevision: profile.revision,
      });
      assert.equal(stale.status, "conflict");
      assert.equal(stale.profile.config.name, "Lime");
      const sql = yield* SqlClient.SqlClient;
      assert.equal(
        (yield* sql<{
          kind: string;
        }>`SELECT kind FROM workspace_thread_metadata WHERE thread_id=${legacy}`)[0]?.kind,
        "assistant",
      );
      yield* sql`UPDATE orchestration_v2_projection_threads SET deleted_at=${at} WHERE thread_id=${legacy}`;
      const replacement = yield* agent.claimConversation();
      assert.notEqual(replacement, legacy);
      assert.equal(yield* agent.claimConversation(), replacement);
    }).pipe(Effect.provide(memory)),
);

it.effect(
  "keeps source references, detects competing corrections, and prevents stale resurrection after forget",
  () =>
    Effect.gen(function* () {
      const agent = yield* PersonalAgent.PersonalAgent;
      const threadId = ThreadId.make("assistant");
      const messageId = MessageId.make("source");
      yield* seed(threadId);
      yield* agent.claimConversation(threadId);
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO orchestration_v2_projection_messages(message_id,thread_id,role,streaming,created_at,updated_at,payload_json) VALUES(${messageId},${threadId},'user',0,${at},${at},'{}')`;
      const initial = {
        ...fact(personal, "home-city", "Austin"),
        sources: [{ label: "User correction", threadId, messageId }],
      };
      yield* agent.remember(initial, owner);
      const corrections = yield* Effect.all(
        [
          agent.remember({ ...initial, content: "Chicago", expectedRevision: 1 }, owner),
          agent.remember({ ...initial, content: "Portland", expectedRevision: 1 }, owner),
        ],
        { concurrency: "unbounded" },
      );
      assert.deepEqual(corrections.map((result) => result.status).sort(), ["conflict", "saved"]);
      const current = (yield* agent.memories({}, owner)).facts[0]!;
      assert.equal(current.revision, 2);
      assert.deepEqual(current.sources, initial.sources);
      const recalled = yield* agent.prepare({ threadId, messageId, prompt: "Where do I live?" });
      assert.include(recalled, current.content);
      assert.notInclude(recalled, "Austin");
      const forgotten = yield* agent.remember(
        { ...initial, action: "forget", expectedRevision: 2 },
        owner,
      );
      assert.equal(forgotten.fact?.content, "");
      assert.deepEqual(forgotten.fact?.sources, []);
      assert.equal(
        (yield* agent.remember({ ...initial, expectedRevision: 2 }, owner)).status,
        "conflict",
      );
      const next = yield* agent.prepare({ threadId, messageId, prompt: "Where do I live?" });
      assert.notInclude(next, current.content);
      assert.include(
        next,
        '"forgotten":[{"scope":{"kind":"personal"},"key":"home-city","revision":3}]',
      );
      assert.isFalse(yield* agent.canForkNative(threadId));
      const rows = yield* sql<{
        content: string;
        sources_json: string;
      }>`SELECT content,sources_json FROM assistant_memory WHERE fact_key='home-city'`;
      assert.deepEqual(rows, [{ content: "", sources_json: "[]" }]);
    }).pipe(Effect.provide(memory)),
);

it.effect(
  "isolates personal, project and thread resources even for full-access workers and delegated callers",
  () =>
    Effect.gen(function* () {
      const agent = yield* PersonalAgent.PersonalAgent;
      const assistant = ThreadId.make("assistant"),
        worker = ThreadId.make("worker"),
        other = ThreadId.make("other-project");
      yield* seed(assistant);
      yield* seed(worker);
      yield* seed(other, ProjectId.make("project-b"));
      yield* agent.claimConversation(assistant);
      yield* agent.remember(fact(personal, "private", "PERSONAL_SECRET"), owner);
      yield* agent.remember(
        fact({ kind: "project", projectId: ProjectId.make("project-a") }, "language", "TypeScript"),
        owner,
      );
      yield* agent.remember(
        fact({ kind: "thread", threadId: assistant }, "draft", "PRIVATE_DRAFT"),
        owner,
      );
      const actor = { kind: "thread" as const, threadId: worker };
      assert.deepEqual(
        (yield* agent.memories({}, actor)).facts.map((item) => item.content),
        ["TypeScript"],
      );
      for (const scope of [
        personal,
        { kind: "thread" as const, threadId: assistant },
        { kind: "project" as const, projectId: ProjectId.make("project-b") },
      ]) {
        assert.equal((yield* agent.memories({ scope }, actor).pipe(Effect.flip)).reason, "denied");
        assert.equal(
          (yield* agent
            .remember(fact(scope, "injection", "should not write"), actor)
            .pipe(Effect.flip)).reason,
          "denied",
        );
      }
      assert.equal(
        (yield* agent
          .memories({ scope: personal }, { kind: "thread", threadId: assistant, delegated: true })
          .pipe(Effect.flip)).reason,
        "denied",
      );
      const sourceLeak = {
        ...fact({ kind: "thread", threadId: worker }, "source", "bad source"),
        sources: [{ threadId: other, messageId: null, label: "foreign" }],
      };
      assert.equal((yield* agent.remember(sourceLeak, actor).pipe(Effect.flip)).reason, "denied");
      assert.equal(
        (yield* agent.memories({}, { kind: "thread", threadId: other })).facts.length,
        0,
      );
      const context = yield* agent.prepare({
        threadId: worker,
        messageId: MessageId.make("coding"),
        prompt: "language",
      });
      assert.include(context, "TypeScript");
      assert.notInclude(context, "PERSONAL_SECRET");
      assert.notInclude(context, "PRIVATE_DRAFT");
      assert.isTrue(yield* agent.canForkNative(worker));
      yield* agent.remember(
        fact({ kind: "thread", threadId: worker }, "local", "Worker-only"),
        actor,
      );
      assert.isFalse(yield* agent.canForkNative(worker));
    }).pipe(Effect.provide(memory)),
);

it.effect(
  "requires both an explicit Bot grant and a trusted scheduler stamp belonging to the actual message thread",
  () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const agent = yield* PersonalAgent.PersonalAgent;
      const bot = ThreadId.make("bot"),
        other = ThreadId.make("unrelated");
      const messageId = MessageId.make("scheduled-message"),
        forged = MessageId.make("forged-message");
      const taskId = ScheduledTaskId.make("allowed-bot");
      const bots = yield* BotStore.BotStore;
      const teammate = yield* bots.create({
        id: BotId.make("scheduled-owner"),
        name: "Researcher",
        description: "Research questions",
      });
      yield* sql`UPDATE workspace_bots SET thread_id=${bot} WHERE bot_id=${teammate.id}`;
      yield* seed(bot);
      yield* seed(other);
      yield* sql`INSERT INTO scheduled_tasks(task_id,title,prompt,enabled,schedule_json,project_id,workspace_strategy_json,model_selection_json,runtime_mode,interaction_mode,created_by,creation_source,created_at,updated_at,last_run_status,run_count) VALUES(${taskId},'Bot','Prompt',1,'{}','project-a','{}','{}','full-access','default','user','web',${at},${at},'never',0)`;
      for (const id of [messageId, forged])
        yield* sql`INSERT INTO orchestration_v2_projection_messages(message_id,thread_id,role,streaming,created_at,updated_at,payload_json) VALUES(${id},${bot},'user',0,${at},${at},'{"scheduledTaskId":"allowed-bot"}')`;
      yield* agent.remember(fact(personal, "preference", "PRIVATE_SCHEDULED_PREFERENCE"), owner);
      const input = { threadId: bot, messageId, prompt: "anything" };
      assert.notInclude(yield* agent.prepare(input), "PRIVATE_SCHEDULED_PREFERENCE");
      const profile = yield* agent.read();
      yield* agent.write({
        config: { ...profile.config, personalMemoryTaskIds: [taskId] },
        expectedRevision: profile.revision,
      });
      // A payload's scheduledTaskId is untrusted; only scheduler-created stamps convey authority.
      assert.notInclude(yield* agent.prepare(input), "PRIVATE_SCHEDULED_PREFERENCE");
      yield* agent.recordJobRun(messageId, taskId);
      assert.include(yield* agent.prepare(input), "PRIVATE_SCHEDULED_PREFERENCE");
      assert.notInclude(
        yield* agent.prepare({ ...input, messageId: forged }),
        "PRIVATE_SCHEDULED_PREFERENCE",
      );
      assert.notInclude(
        yield* agent.prepare({ ...input, threadId: other }),
        "PRIVATE_SCHEDULED_PREFERENCE",
      );
      const granted = yield* agent.read();
      yield* agent.write({
        config: { ...granted.config, personalMemoryTaskIds: [] },
        expectedRevision: granted.revision,
      });
      assert.notInclude(yield* agent.prepare(input), "PRIVATE_SCHEDULED_PREFERENCE");
      assert.isFalse(yield* agent.canForkNative(bot));
      yield* sql`UPDATE workspace_bots SET thread_id=NULL WHERE bot_id=${teammate.id}`;
      yield* agent.claimConversation(bot);
      const ungranted = yield* agent.prepare(input);
      assert.notInclude(ungranted, "PRIVATE_SCHEDULED_PREFERENCE");
      assert.include(ungranted, '"identity":null');
    }).pipe(Effect.provide(memory)),
);

it.effect("bounds serialized recall and ranks relevant facts before unrelated preferences", () =>
  Effect.gen(function* () {
    const agent = yield* PersonalAgent.PersonalAgent;
    const threadId = ThreadId.make("assistant");
    yield* seed(threadId);
    yield* agent.claimConversation(threadId);
    for (let index = 0; index < 20; index++)
      yield* agent.remember(
        fact(personal, `preference-${index}`, `Unrelated ${index}: ${'"'.repeat(900)}`),
        owner,
      );
    yield* agent.remember(fact(personal, "favorite-language", "I prefer TypeScript."), owner);
    const context = yield* agent.prepare({
      threadId,
      messageId: MessageId.make("turn"),
      prompt: "Which language?",
    });
    assert.include(context, "TypeScript");
    assert.isAtMost(context.length, PersonalAgent.MEMORY_CONTEXT_LIMIT);
    assert.isAtMost((context.match(/"content":/g) ?? []).length, PersonalAgent.MEMORY_RECALL_LIMIT);
  }).pipe(Effect.provide(memory)),
);

it.effect(
  "retains identity, canonical thread, corrections and forget tombstones after reopening SQLite",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "bara-personal-" });
      const database = () =>
        PersonalAgent.layer.pipe(Layer.provideMerge(Sqlite.layerFromPath(`${dir}/state.sqlite`)));
      const saved = yield* Effect.gen(function* () {
        const agent = yield* PersonalAgent.PersonalAgent;
        const id = ThreadId.make("persisted-assistant");
        yield* seed(id);
        yield* agent.claimConversation(id);
        const profile = yield* agent.read();
        yield* agent.write({
          config: { ...profile.config, name: "Lime" },
          expectedRevision: profile.revision,
        });
        yield* agent.remember(fact(personal, "city", "Austin"), owner);
        yield* agent.remember(fact(personal, "city", "Chicago", 1), owner);
        yield* agent.remember({ ...fact(personal, "city", "", 2), action: "forget" }, owner);
        const bots = yield* BotStore.BotStore;
        const chef = yield* bots.create({
          id: BotId.make("chef"),
          name: "Chef",
          description: "Help me cook",
        });
        yield* bots.write({
          id: chef.id,
          config: { ...chef.config, toolAccess: "blocked" },
          archived: false,
          expectedRevision: chef.revision,
        });
        const home = yield* bots.get(HOME_BOT_ID);
        yield* bots.write({
          id: home.id,
          config: { ...home.config, toolAccess: "read-only" },
          archived: false,
          expectedRevision: home.revision,
        });
        const compatibility = yield* agent.read();
        yield* agent.write({
          config: { ...compatibility.config, name: "Lime" },
          expectedRevision: compatibility.revision,
        });
        assert.equal((yield* bots.get(HOME_BOT_ID)).config.toolAccess, "read-only");
        const chefThread = yield* bots.claimConversation(BotId.make("chef"));
        yield* seed(chefThread);
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO orchestration_v2_projection_messages(message_id,thread_id,role,streaming,created_at,updated_at,payload_json) VALUES('chef-message',${chefThread},'user',0,${at},${at},'{"text":"Vegetarian meals please"}')`;
        return {
          profile: yield* agent.read(),
          snapshot: yield* agent.memories({}, owner),
          bots: yield* bots.list(),
        };
      }).pipe(Effect.provide(database()));
      const reopened = yield* Effect.gen(function* () {
        const agent = yield* PersonalAgent.PersonalAgent;
        const bots = yield* BotStore.BotStore;
        const sql = yield* SqlClient.SqlClient;
        assert.equal(
          (yield* sql<{
            payload_json: string;
          }>`SELECT payload_json FROM orchestration_v2_projection_messages WHERE message_id='chef-message'`)[0]
            ?.payload_json,
          '{"text":"Vegetarian meals please"}',
        );
        return {
          profile: yield* agent.read(),
          snapshot: yield* agent.memories({}, owner),
          bots: yield* bots.list(),
        };
      }).pipe(Effect.provide(database()));
      assert.deepEqual(reopened, saved);
    }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect(
  "keeps teammate identity and memory inside its relationship conversation and refreshes corrections each turn",
  () =>
    Effect.gen(function* () {
      const bots = yield* BotStore.BotStore;
      const agent = yield* PersonalAgent.PersonalAgent;
      const chef = yield* bots.create({
        id: BotId.make("chef"),
        name: "Chef",
        description: "Help with vegetarian cooking",
      });
      const researcher = yield* bots.create({
        id: BotId.make("researcher"),
        name: "Researcher",
        description: "Research questions",
      });
      const chefThread = yield* bots.claimConversation(chef.id);
      const researchThread = yield* bots.claimConversation(researcher.id);
      yield* seed(chefThread);
      yield* seed(researchThread);
      const homeThread = yield* agent.claimConversation();
      yield* seed(homeThread);
      yield* agent.remember(fact(personal, "private", "Owner-private information"), owner);
      yield* agent.remember(
        fact(
          { kind: "project", projectId: ProjectId.make("project-a") },
          "unrelated",
          "Unrelated scratch-project information",
        ),
        owner,
      );
      yield* agent.remember(
        fact({ kind: "thread", threadId: chefThread }, "diet", "Vegetarian only"),
        owner,
      );
      const prepare = (threadId: ThreadId) =>
        agent.prepare({
          threadId,
          messageId: MessageId.make(`turn-${threadId}`),
          prompt: "diet private unrelated",
        });
      const first = yield* prepare(chefThread);
      assert.include(first, "Help with vegetarian cooking");
      assert.include(first, "Vegetarian only");
      assert.notInclude(first, "Owner-private");
      assert.notInclude(first, "Unrelated scratch-project");
      const other = yield* prepare(researchThread);
      assert.notInclude(other, "Vegetarian only");
      assert.notInclude(other, "Help with vegetarian cooking");
      assert.include(other, "Research questions");
      assert.isFalse(yield* agent.canForkNative(chefThread));
      const saved = yield* bots.write({
        id: chef.id,
        config: { ...chef.config, instructions: "Use metric measurements" },
        archived: false,
        expectedRevision: 1,
      });
      assert.equal(saved.status, "saved");
      assert.include(yield* prepare(chefThread), "Use metric measurements");
      assert.equal(
        (yield* agent.memories({}, { kind: "thread", threadId: chefThread })).scopes.length,
        2,
      );
      const botScope = { kind: "bot" as const, botId: chef.id };
      yield* agent.remember(fact(botScope, "preferences.diet", "Never use peanuts"), {
        kind: "thread",
        threadId: chefThread,
      });
      assert.include(yield* prepare(chefThread), "Never use peanuts");
      assert.notInclude(yield* prepare(researchThread), "Never use peanuts");
      assert.equal(
        (yield* agent
          .memories({ scope: botScope }, { kind: "thread", threadId: researchThread })
          .pipe(Effect.flip)).reason,
        "denied",
      );
      const workThread = ThreadId.make("chef-work");
      yield* seed(workThread, ProjectId.make("project-b"));
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO workspace_thread_metadata(thread_id,kind,title,objective,coordinator_bot_id,scope_project_id,configuration_revision,updated_at) VALUES(${workThread},'focus','Dinner','Plan dinner',${chef.id},'project-b',1,${at})`;
      assert.include(yield* prepare(workThread), "Never use peanuts");
      assert.notInclude(yield* prepare(workThread), "Vegetarian only");
      assert.equal(
        (yield* agent
          .remember(fact(botScope, "project-secret", "Do not promote project data"), {
            kind: "thread",
            threadId: workThread,
          })
          .pipe(Effect.flip)).reason,
        "denied",
      );
      yield* agent.remember({ ...fact(botScope, "preferences.diet", "Use almonds", 1) }, owner);
      assert.notInclude(yield* prepare(workThread), "Never use peanuts");
      yield* agent.remember(
        { ...fact(botScope, "preferences.diet", "", 2), action: "forget" },
        owner,
      );
      assert.notInclude(yield* prepare(workThread), "Use almonds");
      yield* sql`INSERT INTO workspace_pages(id,title,markdown,revision,created_at,updated_at) VALUES('cooking-skill','Cooking procedure','CHECK_ALLERGENS_BEFORE_COOKING',1,${at},${at})`;
      const currentChef = yield* bots.get(chef.id);
      yield* bots.write({
        id: chef.id,
        archived: false,
        expectedRevision: currentChef.revision,
        config: {
          ...currentChef.config,
          capabilities: { ...currentChef.config.capabilities!, skillPageIds: ["cooking-skill"] },
        },
      });
      assert.include(yield* prepare(workThread), "CHECK_ALLERGENS_BEFORE_COOKING");
      assert.notInclude(yield* prepare(researchThread), "CHECK_ALLERGENS_BEFORE_COOKING");
      yield* sql`UPDATE workspace_pages SET markdown='REVISED_COOKING_PROCEDURE',revision=2 WHERE id='cooking-skill'`;
      assert.include(yield* prepare(workThread), "REVISED_COOKING_PROCEDURE");
      yield* sql`UPDATE workspace_pages SET archived=1 WHERE id='cooking-skill'`;
      assert.notInclude(yield* prepare(workThread), "REVISED_COOKING_PROCEDURE");
      const home = yield* bots.get(HOME_BOT_ID);
      const changed = yield* bots.write({
        id: home.id,
        config: { ...home.config, name: "Lime" },
        archived: false,
        expectedRevision: home.revision,
      });
      assert.equal(changed.status, "saved");
      assert.equal((yield* agent.read()).config.name, "Lime");
      const profile = yield* agent.read();
      yield* agent.write({
        config: { ...profile.config, name: "Citrus" },
        expectedRevision: profile.revision,
      });
      assert.equal((yield* bots.get(HOME_BOT_ID)).config.name, "Citrus");
    }).pipe(Effect.provide(memory)),
);
