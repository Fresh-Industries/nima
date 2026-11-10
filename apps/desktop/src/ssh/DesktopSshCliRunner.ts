import type { RemoteT3RunnerOptions } from "@t3tools/ssh/tunnel";
import * as Option from "effect/Option";
import serverPackageJson from "../../../server/package.json" with { type: "json" };

export function resolveDesktopSshCliRunner(environment: {
  readonly isDevelopment: boolean;
  readonly devRemoteT3ServerEntryPath: Option.Option<string>;
}): RemoteT3RunnerOptions {
  const devRemoteEntryPath = Option.getOrUndefined(environment.devRemoteT3ServerEntryPath);
  return environment.isDevelopment && devRemoteEntryPath !== undefined
    ? { nodeScriptPath: devRemoteEntryPath, nodeEngineRange: serverPackageJson.engines.node }
    : {
        archiveVersion: serverPackageJson.version,
        releaseBaseUrl: "https://github.com/Fresh-Industries/nima/releases/download",
      };
}
