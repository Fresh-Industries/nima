import { expect, it } from "vite-plus/test";
import * as Option from "effect/Option";
import { buildRemoteT3RunnerScript } from "@t3tools/ssh/tunnel";
import { resolveDesktopSshCliRunner } from "./DesktopSshCliRunner.ts";

it("keeps SSH downloads on an existing upstream release when Bara's version changes", () => {
  const environment = {
    appVersion: "0.1.7",
    isDevelopment: false,
    devRemoteT3ServerEntryPath: Option.none<string>(),
  };
  const runner = resolveDesktopSshCliRunner(environment);
  expect(runner).toEqual({ archiveVersion: "0.1.6" });
  const script = buildRemoteT3RunnerScript(runner);
  expect(script).toContain("T3_ARCHIVE_VERSION='0.1.6'");
  expect(script).not.toContain("0.1.7");
});
it("retains explicit development runners without using them in packaged builds", () => {
  const runner = {
    devRemoteT3ServerEntryPath: Option.some("/dev/bara/bin.ts"),
    isDevelopment: true,
  };
  expect(resolveDesktopSshCliRunner(runner)).toMatchObject({ nodeScriptPath: "/dev/bara/bin.ts" });
  expect(resolveDesktopSshCliRunner({ ...runner, isDevelopment: false })).toEqual({
    archiveVersion: "0.1.6",
  });
});
