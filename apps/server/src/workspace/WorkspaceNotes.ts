import {
  WorkspaceNote,
  WorkspaceNoteError,
  WorkspaceNoteWriteInput,
  type WorkspaceNoteWriteResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

export class WorkspaceNotes extends Context.Service<
  WorkspaceNotes,
  {
    readonly read: () => Effect.Effect<WorkspaceNote, WorkspaceNoteError>;
    readonly write: (
      input: WorkspaceNoteWriteInput,
    ) => Effect.Effect<WorkspaceNoteWriteResult, WorkspaceNoteError>;
    readonly subscribe: () => Stream.Stream<WorkspaceNote, WorkspaceNoteError>;
  }
>()("t3/workspace/WorkspaceNotes") {}

const decodeNote = Schema.decodeUnknownEffect(WorkspaceNote);
const decodeWrite = Schema.decodeEffect(WorkspaceNoteWriteInput);

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const changes = yield* PubSub.sliding<void>(1);
  const read = Effect.fn("WorkspaceNotes.read")(
    function* () {
      const rows =
        yield* sql`SELECT markdown, revision, updated_at AS "updatedAt" FROM workspace_notes WHERE id = 1`;
      return yield* decodeNote(rows[0]);
    },
    Effect.mapError((cause) => new WorkspaceNoteError({ operation: "read", cause })),
  );

  const write = Effect.fn("WorkspaceNotes.write")(
    function* (raw: WorkspaceNoteWriteInput) {
      const input = yield* decodeWrite(raw);
      const result = yield* sql.withTransaction(
        Effect.gen(function* () {
          const current = yield* read();
          if (current.markdown === input.markdown)
            return { status: "saved" as const, note: current };
          if (current.revision !== input.expectedRevision)
            return { status: "conflict" as const, note: current };
          const now = yield* DateTime.now;
          const note = {
            markdown: input.markdown,
            revision: current.revision + 1,
            updatedAt: DateTime.formatIso(now),
          };
          yield* sql`UPDATE workspace_notes SET markdown = ${note.markdown}, revision = ${note.revision}, updated_at = ${note.updatedAt} WHERE id = 1`;
          return { status: "saved" as const, note };
        }),
      );
      if (result.status === "saved") yield* PubSub.publish(changes, undefined);
      return result;
    },
    Effect.mapError((cause) => new WorkspaceNoteError({ operation: "write", cause })),
    Effect.uninterruptible,
  );

  return WorkspaceNotes.of({
    read,
    write,
    subscribe: () =>
      Stream.unwrap(
        Effect.gen(function* () {
          // Buffer invalidations before reading so a concurrent save cannot be missed.
          const subscription = yield* PubSub.subscribe(changes);
          return Stream.concat(
            Stream.fromEffect(read()),
            Stream.fromSubscription(subscription).pipe(Stream.mapEffect(read)),
          );
        }),
      ),
  });
});

export const layer = Layer.effect(WorkspaceNotes, make);
