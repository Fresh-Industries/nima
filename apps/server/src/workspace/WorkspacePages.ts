import {
  WORKSPACE_NOTE_MAX_LENGTH,
  WorkspacePage,
  WorkspacePageContent,
  WorkspacePageError,
  WorkspacePageWriteInput,
  WorkspacePagesListInput,
  WorkspacePageCaptureInput,
  WorkspacePageReadInput,
  WorkspacePagesList,
  type WorkspacePageWriteResult,
  type WorkspacePagesSnapshot,
  type WorkspacePagesSubscribeInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

export class WorkspacePages extends Context.Service<
  WorkspacePages,
  {
    readonly list: (
      input: WorkspacePagesListInput,
    ) => Effect.Effect<WorkspacePagesList, WorkspacePageError>;
    readonly read: (
      input: typeof WorkspacePageReadInput.Type,
    ) => Effect.Effect<WorkspacePage | null, WorkspacePageError>;
    readonly write: (
      input: WorkspacePageWriteInput,
    ) => Effect.Effect<WorkspacePageWriteResult, WorkspacePageError>;
    readonly capture: (
      input: WorkspacePageCaptureInput,
    ) => Effect.Effect<WorkspacePageWriteResult, WorkspacePageError>;
    readonly subscribe: (
      input: WorkspacePagesSubscribeInput,
    ) => Stream.Stream<WorkspacePagesSnapshot, WorkspacePageError>;
  }
>()("t3/workspace/WorkspacePages") {}

const decodePage = Schema.decodeUnknownEffect(WorkspacePage);
const decodeList = Schema.decodeUnknownEffect(WorkspacePagesList);
const decodeListInput = Schema.decodeUnknownEffect(WorkspacePagesListInput);
const decodeRead = Schema.decodeUnknownEffect(WorkspacePageReadInput);
const decodeWrite = Schema.decodeUnknownEffect(WorkspacePageWriteInput);
const decodeCapture = Schema.decodeUnknownEffect(WorkspacePageCaptureInput);
const encodeContent = Schema.encodeSync(Schema.fromJsonString(WorkspacePageContent));
const isPageError = Schema.is(WorkspacePageError);
const failure = (reason: "read" | "write") => (cause: unknown) =>
  isPageError(cause) ? cause : new WorkspacePageError({ reason, cause });

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const changes = yield* PubSub.sliding<void>(1);
  const read = Effect.fn("WorkspacePages.read")(
    function* (raw: typeof WorkspacePageReadInput.Type) {
      const input = yield* decodeRead(raw);
      const [row] = yield* sql<{
        id: string;
        title: string;
        markdown: string;
        archived: number;
        sourceThreadId: string | null;
        sourceRunId: string | null;
        revision: number;
        createdAt: string;
        updatedAt: string;
      }>`
      SELECT id, title, markdown, archived, source_thread_id AS sourceThreadId, source_run_id AS sourceRunId,
        revision, created_at AS createdAt, updated_at AS updatedAt FROM workspace_pages WHERE id = ${input.id}`;
      return row
        ? yield* decodePage({
            id: row.id,
            content: {
              title: row.title,
              markdown: row.markdown,
              archived: row.archived === 1,
              source:
                row.sourceThreadId && row.sourceRunId
                  ? { threadId: row.sourceThreadId, runId: row.sourceRunId }
                  : null,
            },
            revision: row.revision,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          })
        : null;
    },
    Effect.mapError(failure("read")),
  );

  const list = Effect.fn("WorkspacePages.list")(
    function* (raw: WorkspacePagesListInput) {
      const input = yield* decodeListInput(raw);
      const rows = yield* sql<{
        archived: number;
        sourceThreadId: string | null;
        sourceRunId: string | null;
        updatedAt: string;
        id: string;
      }>`
      SELECT id, title, archived, substr(markdown, 1, 180) AS excerpt, revision, updated_at AS updatedAt,
        source_thread_id AS sourceThreadId, source_run_id AS sourceRunId FROM workspace_pages
      WHERE archived = ${input.archived ? 1 : 0}
        AND instr(lower(title || char(10) || markdown), lower(${input.query?.trim() ?? ""})) > 0
        AND (${input.before ? 0 : 1} = 1 OR updated_at < ${input.before?.at ?? ""} OR (updated_at = ${input.before?.at ?? ""} AND id < ${input.before?.id ?? ""}))
      ORDER BY updated_at DESC, id DESC LIMIT 51`;
      const last = rows.slice(0, 50).at(-1);
      return yield* decodeList({
        pages: rows.slice(0, 50).map((row) => ({
          ...row,
          archived: row.archived === 1,
          source:
            row.sourceThreadId && row.sourceRunId
              ? { threadId: row.sourceThreadId, runId: row.sourceRunId }
              : null,
        })),
        nextCursor: rows.length > 50 && last ? { at: last.updatedAt, id: last.id } : null,
      });
    },
    Effect.mapError(failure("read")),
  );

  const write = Effect.fn("WorkspacePages.write")(
    function* (raw: WorkspacePageWriteInput) {
      const input = yield* decodeWrite(raw);
      const result = yield* sql.withTransaction(
        Effect.gen(function* () {
          const current = yield* read(input);
          if (current && encodeContent(current.content) === encodeContent(input.content))
            return { status: "saved" as const, page: current };
          if ((current?.revision ?? 0) !== input.expectedRevision)
            return { status: "conflict" as const, page: current };
          const at = DateTime.formatIso(yield* DateTime.now);
          yield* sql`INSERT INTO workspace_pages (id, title, markdown, archived, source_thread_id, source_run_id, revision, created_at, updated_at)
        VALUES (${input.id}, ${input.content.title}, ${input.content.markdown}, ${input.content.archived ? 1 : 0}, ${input.content.source?.threadId ?? null}, ${input.content.source?.runId ?? null}, 1, ${at}, ${at})
        ON CONFLICT(id) DO UPDATE SET title = excluded.title, markdown = excluded.markdown, archived = excluded.archived,
          source_thread_id = excluded.source_thread_id, source_run_id = excluded.source_run_id, revision = workspace_pages.revision + 1, updated_at = excluded.updated_at`;
          return { status: "saved" as const, page: yield* read(input) };
        }),
      );
      if (result.status === "saved") yield* PubSub.publish(changes, undefined);
      return result;
    },
    Effect.mapError(failure("write")),
    Effect.uninterruptible,
  );

  const capture = Effect.fn("WorkspacePages.capture")(
    function* (raw: WorkspacePageCaptureInput) {
      const input = yield* decodeCapture(raw);
      const current = yield* read(input);
      if (
        current?.content.source?.threadId === input.threadId &&
        current.content.source.runId === input.runId
      )
        return { status: "saved" as const, page: current };
      const [result] = yield* sql<{ title: string; markdown: string | null }>`
        SELECT thread.title, (SELECT json_extract(reply.payload_json, '$.text') FROM orchestration_v2_projection_messages AS reply
          WHERE reply.thread_id = run.thread_id AND reply.run_id = run.run_id AND reply.role = 'assistant'
          ORDER BY reply.created_at DESC, reply.message_id DESC LIMIT 1) AS markdown
        FROM orchestration_v2_projection_runs AS run JOIN orchestration_v2_projection_threads AS thread ON thread.thread_id = run.thread_id
        WHERE run.thread_id = ${input.threadId} AND run.run_id = ${input.runId} AND thread.deleted_at IS NULL
          AND run.status IN ('completed', 'failed', 'interrupted', 'cancelled') AND run.completed_at IS NOT NULL`;
      if (!result?.markdown?.trim())
        return yield* new WorkspacePageError({ reason: "unavailable" });
      if (result.markdown.length > WORKSPACE_NOTE_MAX_LENGTH)
        return yield* new WorkspacePageError({ reason: "too_large" });
      return yield* write({
        id: input.id,
        expectedRevision: 0,
        content: {
          title: input.title ?? (result.title.trim().slice(0, 200) || "Saved result"),
          markdown: result.markdown,
          archived: false,
          source: { threadId: input.threadId, runId: input.runId },
        },
      });
    },
    Effect.mapError(failure("write")),
    Effect.uninterruptible,
  );

  return WorkspacePages.of({
    read,
    list,
    write,
    capture,
    subscribe: (input) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(changes);
          const snapshot = Effect.gen(function* () {
            return {
              ...(yield* list(input)),
              page: input.id ? yield* read({ id: input.id }) : null,
            };
          }).pipe(sql.withTransaction, Effect.mapError(failure("read")));
          return Stream.concat(
            Stream.fromEffect(snapshot),
            Stream.fromSubscription(subscription).pipe(Stream.mapEffect(() => snapshot)),
          );
        }),
      ),
  });
});
export const layer = Layer.effect(WorkspacePages, make);
