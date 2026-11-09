import type { RemoteT3RunnerOptions } from "@t3tools/ssh/tunnel";
import * as Option from "effect/Option";
import serverPackageJson from "../../../server/package.json" with { type: "json" };

// Bara's desktop version does not name a release of the upstream SSH runtime.
const SSH_RUNTIME_VERSION = "0.1.6";

export function resolveDesktopSshCliRunner(environment: {
  readonly isDevelopment: boolean;
  readonly devRemoteT3ServerEntryPath: Option.Option<string>;
}): RemoteT3RunnerOptions {
  const devRemoteEntryPath = Option.getOrUndefined(environment.devRemoteT3ServerEntryPath);
  return environment.isDevelopment && devRemoteEntryPath !== undefined
    ? { nodeScriptPath: devRemoteEntryPath, nodeEngineRange: serverPackageJson.engines.node }
    : { archiveVersion: SSH_RUNTIME_VERSION };
}
