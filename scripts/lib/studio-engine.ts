import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

export class DesktopStudioEngineMissingError extends Schema.TaggedError<DesktopStudioEngineMissingError>()(
  "DesktopStudioEngineMissingError",
  { binaryPath: Schema.optional(Schema.String) },
) {
  override get message() {
    return "Build bara-cli in the separate Bara engine checkout, then set BARA_STUDIO_ENGINE_BINARY to that platform's executable when packaging the desktop app.";
  }
}

export const stageStudioEngine = Effect.fn("desktopArtifact.stageStudioEngine")(function* (input: {
  readonly binaryPath: string | undefined;
  readonly stageResourcesDir: string;
  readonly platform: "mac" | "linux" | "win";
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  if (!input.binaryPath || !(yield* fs.exists(input.binaryPath)))
    return yield* new DesktopStudioEngineMissingError({ binaryPath: input.binaryPath });
  const folder = path.join(input.stageResourcesDir, "studio");
  yield* fs.makeDirectory(folder, { recursive: true });
  const target = path.join(folder, input.platform === "win" ? "bara-cli.exe" : "bara-cli");
  yield* fs.copyFile(input.binaryPath, target);
  if (input.platform !== "win") yield* fs.chmod(target, 0o755);
});
