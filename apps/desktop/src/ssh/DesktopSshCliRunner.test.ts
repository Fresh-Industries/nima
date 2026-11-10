import { expect, it } from "vite-plus/test";
import * as Option from "effect/Option";
import { buildRemoteT3RunnerScript } from "@t3tools/ssh/tunnel";
import { resolveDesktopSshCliRunner } from "./DesktopSshCliRunner.ts";
import serverPackageJson from "../../../server/package.json" with { type: "json" };

it("downloads a matching Bara backend rather than a T3 backend without Inbox or Studio", () => {
  const environment = {
    appVersion: "0.1.7",
    isDevelopment: false,
    devRemoteT3ServerEntryPath: Option.none<string>(),
  };
  const runner = resolveDesktopSshCliRunner(environment);
  expect(runner).toEqual({
    archiveVersion: serverPackageJson.version,
    releaseBaseUrl: "https://github.com/Fresh-Industries/nima/releases/download",
  });
  const script = buildRemoteT3RunnerScript(runner);
  expect(script).toContain(`T3_ARCHIVE_VERSION='${serverPackageJson.version}'`);
  expect(script).toContain(
    "T3_RELEASE_BASE_URL='https://github.com/Fresh-Industries/nima/releases/download'",
  );
  expect(script).not.toContain("pingdotgg/t3code");
});
it("retains explicit development runners without using them in packaged builds", () => {
  const runner = {
    devRemoteT3ServerEntryPath: Option.some("/dev/bara/bin.ts"),
    isDevelopment: true,
  };
  expect(resolveDesktopSshCliRunner(runner)).toMatchObject({ nodeScriptPath: "/dev/bara/bin.ts" });
  expect(resolveDesktopSshCliRunner({ ...runner, isDevelopment: false })).toEqual({
    archiveVersion: serverPackageJson.version,
    releaseBaseUrl: "https://github.com/Fresh-Industries/nima/releases/download",
  });
});
