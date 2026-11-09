import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { stageStudioEngine } from "./studio-engine.ts";

it.effect("refuses to produce another desktop build with its Studio engine missing", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped();
    const error = yield* Effect.flip(
      stageStudioEngine({ binaryPath: undefined, stageResourcesDir: root, platform: "win" }),
    );
    assert.equal(error._tag, "DesktopStudioEngineMissingError");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("ships the separate engine executable at the desktop launcher's expected path", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped();
    const source = path.join(root, "bara-cli.exe");
    yield* fs.writeFileString(source, "separately built Studio engine");
    const resources = path.join(root, "resources");
    yield* stageStudioEngine({ binaryPath: source, stageResourcesDir: resources, platform: "win" });
    assert.equal(
      yield* fs.readFileString(path.join(resources, "studio", "bara-cli.exe")),
      "separately built Studio engine",
    );
    assert.equal(yield* fs.readFileString(source), "separately built Studio engine");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
