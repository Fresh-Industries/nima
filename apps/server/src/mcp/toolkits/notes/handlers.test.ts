import { expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Sqlite from "../../../persistence/Sqlite.ts";
import * as WorkspaceNotes from "../../../workspace/WorkspaceNotes.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { liveThreadsLayer } from "../../McpToolAccess.testkit.ts";
import * as Handlers from "./handlers.ts";
import { NotesToolkit } from "./tools.ts";

it.effect.each(["read-only", "approval-required", "full-access"] as const)(
  "enforces %s MCP access on the shared note and returns revisions for safe edits",
  (access) =>
    Effect.gen(function* () {
      const toolkit = yield* NotesToolkit;
      const notes = yield* WorkspaceNotes.WorkspaceNotes;
      const read = yield* toolkit
        .handle("t3_notes_read", {})
        .pipe(Stream.unwrap, Stream.runCollect);
      expect(read.at(-1)?.result).toMatchObject({ markdown: "", revision: 0 });
      const write = yield* toolkit
        .handle("t3_notes_write", { markdown: "# From the assistant", expectedRevision: 0 })
        .pipe(Stream.unwrap, Stream.runCollect);
      if (access !== "full-access") {
        expect(write.at(-1)?.result).toMatchObject({ code: "capability_denied" });
        expect((yield* notes.read()).revision).toBe(0);
      } else {
        expect(write.at(-1)?.result).toMatchObject({
          status: "saved",
          note: { markdown: "# From the assistant", revision: 1 },
        });
        const stale = yield* toolkit
          .handle("t3_notes_write", { markdown: "stale overwrite", expectedRevision: 0 })
          .pipe(Stream.unwrap, Stream.runCollect);
        expect(stale.at(-1)?.result).toMatchObject({ status: "conflict", note: { revision: 1 } });
        expect((yield* notes.read()).markdown).toBe("# From the assistant");
      }
    }).pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(Handlers.layer).pipe(
          Layer.provideMerge(
            Layer.mergeAll(
              WorkspaceNotes.layer.pipe(Layer.provide(Sqlite.layerMemory)),
              liveThreadsLayer,
              Layer.succeed(McpInvocationContext.McpInvocationContext, {
                environmentId: EnvironmentId.make("bara-notes-test"),
                requestNamespace: "notes-test",
                thread: undefined,
                client: { sessionId: "notes-client", label: "Notes test client", access },
                capabilities: new Set(["orchestration"] as const),
                issuedAt: 0,
              }),
            ),
          ),
        ),
      ),
    ),
);
