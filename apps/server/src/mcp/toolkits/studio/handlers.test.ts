import { expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as Studio from "../../../studio/Studio.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { liveThreadsLayer } from "../../McpToolAccess.testkit.ts";
import * as Handlers from "./handlers.ts";
import { StudioToolkit } from "./tools.ts";

it.effect.each(["read-only", "approval-required", "full-access"] as const)(
  "checks %s access before invoking the creative engine and omits embedded image bytes",
  (access) =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0);
      const snapshot = {
        available: true,
        message: null,
        data: { revision: 0, png_base64: "image bytes" },
        svg: "<svg/>",
      };
      yield* Effect.gen(function* () {
        const toolkit = yield* StudioToolkit;
        const read = yield* toolkit
          .handle("t3_studio_inspect", { scope: "studio" })
          .pipe(Stream.unwrap, Stream.runCollect);
        expect(read.at(-1)?.result).toEqual({
          available: true,
          message: null,
          data: { revision: 0, png_base64: "[stored image bytes omitted]" },
        });
        const write = yield* toolkit
          .handle("t3_studio_edit", {
            operation: "create",
            area: "design",
            requestId: "00000000-0000-4000-8000-000000000001",
            expectedRevision: 0,
            payload: {},
          })
          .pipe(Stream.unwrap, Stream.runCollect);
        expect(yield* Ref.get(calls)).toBe(access === "full-access" ? 1 : 0);
        expect(write.at(-1)?.result).toMatchObject(
          access === "full-access" ? { revision: 1 } : { code: "capability_denied" },
        );
      }).pipe(
        Effect.provide(
          McpToolAccess.HandlersLayer.layer(Handlers.layer).pipe(
            Layer.provideMerge(
              Layer.mergeAll(
                Layer.succeed(
                  Studio.Studio,
                  Studio.Studio.of({
                    read: () => Effect.succeed(snapshot),
                    mutate: () =>
                      Ref.updateAndGet(calls, (count) => count + 1).pipe(
                        Effect.map((revision) => ({ revision })),
                      ),
                    exportFile: () => Effect.succeed({ files: [] }),
                    subscribe: () => Stream.succeed(snapshot),
                  }),
                ),
                liveThreadsLayer,
                Layer.succeed(McpInvocationContext.McpInvocationContext, {
                  environmentId: EnvironmentId.make("bara-studio-test"),
                  requestNamespace: "studio-test",
                  thread: undefined,
                  client: { sessionId: "studio-client", label: "Studio test client", access },
                  capabilities: new Set(["orchestration"] as const),
                  issuedAt: 0,
                }),
              ),
            ),
          ),
        ),
      );
    }),
);
