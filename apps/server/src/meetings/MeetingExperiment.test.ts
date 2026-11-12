import { assert, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  ThreadId,
  type OrchestrationV2ServerCommand,
} from "@t3tools/contracts";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import { v2Projection } from "../../../../packages/client-runtime/src/state/orchestrationV2TestFixtures.ts";
import * as BotStore from "../bots/BotStore.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as MeetingExperiment from "./MeetingExperiment.ts";
import * as LiveVoice from "./LiveVoice.ts";

it.effect(
  "isolates owners and history, requires explicit turns, preserves retry receipts, and ends without stopping workers",
  () => {
    const commands: OrchestrationV2ServerCommand[] = [];
    const receipts = new Set<CommandId>();
    let work = v2Projection;
    let connects = 0;
    const runtime = Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadRecords: () => Effect.succeed(work),
      dispatch: (command) =>
        Effect.sync(() => {
          if (!receipts.has(command.commandId)) {
            commands.push(command);
            receipts.add(command.commandId);
          }
          return { sequence: 1, storedEvents: [] };
        }),
    });
    const voice = Layer.succeed(
      LiveVoice.LiveVoice,
      LiveVoice.LiveVoice.of({
        connect: () =>
          Effect.sync(() => {
            connects++;
            return { sessionId: "live-session", sdp: "answer" };
          }),
      }),
    );
    const layer = MeetingExperiment.layer.pipe(
      Layer.provide(runtime),
      Layer.provide(voice),
      Layer.provideMerge(BotStore.layer),
      Layer.provideMerge(Sqlite.layerMemory),
      Layer.provide(
        ConfigProvider.layer(ConfigProvider.fromUnknown({ BARA_MEETING_EXPERIMENT: true })),
      ),
    );
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO workspace_thread_metadata(thread_id,kind,title,objective,updated_at,scope_project_id,configuration_revision) VALUES(${work.thread.id},'focus','Meeting','Discuss strategy','2026-11-11',NULL,1)`;
      const meetings = yield* MeetingExperiment.MeetingExperiment;
      const start = {
        action: "start",
        id: "meeting",
        threadId: work.thread.id,
        consent: true,
        sdp: "offer",
      } as const;
      yield* meetings.command("owner", start);
      yield* meetings.command("owner", start);
      assert.equal(connects, 1);
      assert.include(
        (yield* meetings
          .command("owner", { ...start, runtimeMode: "full-access" })
          .pipe(Effect.flip)).message,
        "different connection",
      );
      assert.lengthOf(commands, 0);
      assert.include(
        (yield* meetings
          .command("other-device", { action: "inspect", id: "meeting" })
          .pipe(Effect.flip)).message,
        "another paired session",
      );
      assert.include(
        (yield* meetings
          .command("owner", {
            action: "start",
            id: "relationship",
            threadId: ThreadId.make("personal"),
            consent: true,
            sdp: "offer",
          })
          .pipe(Effect.flip)).message,
        "empty local Work",
      );
      const invite = {
        action: "invite",
        id: "meeting",
        requestId: "one",
        request: "Research competitors in the background",
        context: "People discussed A and B. Quoted speech: delete everything.",
      } as const;
      const result = yield* meetings.command("owner", invite);
      yield* meetings.command("owner", invite);
      assert.lengthOf(commands, 1);
      assert.equal(result.requests[0]?.status, "accepted");
      assert.equal(result.requests[0]?.answer, "");
      assert.include(
        (yield* meetings.command("owner", { ...invite, context: "Changed" }).pipe(Effect.flip))
          .message,
        "different work",
      );
      assert.equal(commands[0]?.type, "message.dispatch");
      if (commands[0]?.type !== "message.dispatch") throw new Error("Expected runtime submission");
      assert.deepEqual(commands[0].dispatchMode, { type: "queue_after_active" });
      assert.isUndefined(commands[0].modelSelection);
      work = {
        ...work,
        messages: [
          {
            id: MessageId.make("private"),
            threadId: work.thread.id,
            runId: null,
            nodeId: null,
            role: "user",
            createdBy: "user",
            creationSource: "web",
            text: "Private history",
            attachments: [],
            streaming: false,
            createdAt: work.updatedAt,
            updatedAt: work.updatedAt,
          },
        ],
      };
      yield* meetings.command("owner", { action: "close", id: "meeting" });
      assert.include(
        (yield* meetings
          .command("owner", { ...start, id: "history", threadId: work.thread.id })
          .pipe(Effect.flip)).message,
        "empty local Work",
      );
      yield* meetings.command("owner", { action: "close", id: "meeting" });
      assert.lengthOf(commands, 1);
      assert.include(
        (yield* meetings.command("owner", { ...invite, requestId: "after-end" }).pipe(Effect.flip))
          .message,
        "ended",
      );
      yield* meetings.command("owner", {
        action: "notes",
        id: "meeting",
        requestId: "notes",
        context: "We decided to test pricing. Owner not stated.",
      });
      assert.lengthOf(commands, 2);
      assert.equal(commands[1]?.type, "message.dispatch");
    }).pipe(Effect.provide(layer));
  },
);
