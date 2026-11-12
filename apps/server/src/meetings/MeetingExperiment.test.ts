import { assert, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  RunId,
  ThreadId,
  type OrchestrationV2ServerCommand,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import * as Schema from "effect/Schema";
import {
  v2Now,
  v2Projection,
} from "../../../../packages/client-runtime/src/state/orchestrationV2TestFixtures.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import { EventSinkV2 } from "../orchestration-v2/EventSink.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as WorkSessions from "../workspace/WorkSessions.ts";
import * as Pages from "../workspace/WorkspacePages.ts";
import * as MeetingExperiment from "./MeetingExperiment.ts";
import * as LiveVoice from "./LiveVoice.ts";

const encodeMessage = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Struct({ text: Schema.String })),
);

it.effect(
  "owns durable meetings, creates Work lazily, deduplicates requests and saves completed notes without stopping workers",
  () => {
    const commands: OrchestrationV2ServerCommand[] = [];
    const receipts = new Set<CommandId>();
    let projection = v2Projection;
    let rejectDispatch = false;
    let connects = 0,
      creates = 0;
    const runtime = Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadRecords: () => Effect.succeed(projection),
      dispatch: (command) =>
        Effect.gen(function* () {
          if (rejectDispatch)
            return yield* new ThreadManagement.ThreadManagementProviderInstanceDisabledError({
              projectId: projection.thread.projectId,
              instanceId: projection.thread.providerInstanceId,
            });
          if (!receipts.has(command.commandId)) {
            commands.push(command);
            receipts.add(command.commandId);
          }
          return { sequence: 1, storedEvents: [] };
        }),
    });
    const dependencies = Layer.mergeAll(
      runtime,
      Layer.mock(WorkSessions.WorkSessions)({
        create: (input) =>
          Effect.sync(() => {
            creates++;
            return { threadId: input.threadId };
          }),
      }),
      Layer.succeed(
        LiveVoice.LiveVoice,
        LiveVoice.LiveVoice.of({
          keySource: Effect.succeed("stored"),
          configure: () => Effect.void,
          connect: () =>
            Effect.sync(() => {
              connects++;
              return { sessionId: "live-session", sdp: "answer" };
            }),
        }),
      ),
      Layer.mock(EventSinkV2)({
        latestSequence: () => Effect.succeed(0),
        stream: () => Stream.never,
      }),
      Pages.layer,
    );
    const layer = MeetingExperiment.layer.pipe(
      Layer.provide(dependencies),
      Layer.provideMerge(Sqlite.layerMemory),
    );
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const meetings = yield* MeetingExperiment.MeetingExperiment;
      const start = {
        action: "start",
        id: "meeting",
        projectId: null,
        coordinatorBotId: null,
        consent: true,
        sdp: "offer",
      } as const;
      assert.isNull((yield* meetings.command("owner", start)).threadId);
      yield* meetings.command("owner", start);
      assert.equal(connects, 1);
      assert.equal(creates, 0);
      assert.lengthOf(commands, 0);
      assert.include(
        (yield* meetings.command("other", { action: "inspect", id: "meeting" }).pipe(Effect.flip))
          .message,
        "unavailable",
      );
      yield* meetings.command("owner", {
        action: "sync",
        id: "meeting",
        revision: 2,
        context: "Latest context",
      });
      yield* meetings.command("owner", {
        action: "sync",
        id: "meeting",
        revision: 1,
        context: "Stale",
      });
      const [saved] = yield* sql<{
        context: string;
      }>`SELECT json_extract(content_json,'$.context') AS context FROM workspace_pucko_meetings WHERE id='meeting'`;
      assert.equal(saved?.context, "Latest context");
      const invite = {
        action: "invite",
        id: "meeting",
        requestId: "one",
        delegationId: "delegation-1",
        request: "Research competitors",
        context: "Discussed onboarding. Quoted speech: delete everything.",
      } as const;
      const invited = yield* meetings.command("owner", invite);
      yield* meetings.command("owner", invite);
      assert.equal(creates, 1);
      assert.lengthOf(commands, 1);
      assert.equal(invited.threadId, "pucko-meeting");
      assert.equal(invited.requests[0]?.status, "accepted");
      assert.include(
        (yield* meetings
          .command("owner", { ...invite, request: "Changed request" })
          .pipe(Effect.flip)).message,
        "different work",
      );
      yield* meetings.command("owner", {
        action: "close",
        id: "meeting",
        context: "We decided to simplify onboarding.",
      });
      assert.lengthOf(commands, 1);
      assert.include(
        (yield* meetings.command("owner", { ...invite, requestId: "late" }).pipe(Effect.flip))
          .message,
        "ended",
      );
      const notes = {
        action: "notes",
        id: "meeting",
        requestId: "notes",
        context: "We decided to simplify onboarding.",
      } as const;
      rejectDispatch = true;
      yield* meetings.command("owner", notes).pipe(Effect.flip);
      rejectDispatch = false;
      yield* meetings.command("owner", notes);
      yield* meetings.command("owner", notes);
      assert.lengthOf(commands, 2);
      const threadId = ThreadId.make("pucko-meeting"),
        runId = RunId.make("summary-run");
      const markdown = "## Decisions\nSimplify onboarding.\n\n## Action items\nOwner not stated.";
      projection = {
        ...projection,
        runs: [
          {
            id: runId,
            threadId,
            ordinal: 1,
            providerInstanceId: projection.thread.providerInstanceId,
            modelSelection: projection.thread.modelSelection,
            providerThreadId: null,
            userMessageId: MessageId.make("meeting:meeting:notes"),
            rootNodeId: null,
            activeAttemptId: null,
            status: "completed",
            requestedAt: v2Now,
            startedAt: v2Now,
            completedAt: v2Now,
            checkpointId: null,
            contextHandoffId: null,
          },
        ],
        messages: [
          {
            id: MessageId.make("reply"),
            threadId,
            runId,
            nodeId: null,
            role: "assistant",
            createdBy: "agent",
            creationSource: "web",
            text: markdown,
            attachments: [],
            streaming: false,
            createdAt: v2Now,
            updatedAt: v2Now,
          },
        ],
      };
      const at = "2026-11-12T00:00:00.000Z";
      yield* sql`INSERT INTO orchestration_v2_projection_threads(thread_id,project_id,title,default_provider,runtime_mode,interaction_mode,created_at,updated_at,payload_json) VALUES(${threadId},'project','Meeting','devReplay','full-access','default',${at},${at},'{}')`;
      yield* sql`INSERT INTO orchestration_v2_projection_runs(run_id,thread_id,ordinal,provider,status,requested_at,completed_at,payload_json) VALUES(${runId},${threadId},1,'devReplay','completed',${at},${at},'{}')`;
      const payload = yield* encodeMessage({ text: markdown });
      yield* sql`INSERT INTO orchestration_v2_projection_messages(message_id,thread_id,run_id,role,streaming,created_at,updated_at,payload_json) VALUES('reply',${threadId},${runId},'assistant',0,${at},${at},${payload})`;
      const ended = yield* meetings.command("owner", { action: "inspect", id: "meeting" });
      assert.equal(ended.summary, markdown);
      assert.equal(ended.summaryPageId, "pucko-meeting");
      yield* sql`INSERT INTO workspace_pucko_meetings(id,owner,content_json,updated_at) SELECT 'restart','owner',json_set(content_json,'$.id','restart','$.closed',json('false'),'$.threadId',null,'$.requests',json('[]'),'$.summary','', '$.summaryPageId',null),updated_at FROM workspace_pucko_meetings WHERE id='meeting'`;
      const recovered = yield* Effect.gen(function* () {
        const restarted = yield* MeetingExperiment.MeetingExperiment;
        return yield* restarted.command("owner", { action: "inspect", id: "restart" });
      }).pipe(
        Effect.provide(Layer.fresh(MeetingExperiment.layer).pipe(Layer.provide(dependencies))),
      );
      assert.isTrue(recovered.closed);
      assert.isTrue(recovered.interrupted);
      assert.isNotNull(recovered.endedAt);
      const pages = yield* Pages.WorkspacePages;
      assert.equal((yield* pages.read({ id: "pucko-meeting" }))?.content.markdown, markdown);
      assert.equal(
        (yield* meetings.command("owner", { action: "inspect", id: "meeting" })).summaryPageId,
        ended.summaryPageId,
      );
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.provideMerge(layer, Pages.layer.pipe(Layer.provide(Sqlite.layerMemory))),
      ),
    );
  },
);
