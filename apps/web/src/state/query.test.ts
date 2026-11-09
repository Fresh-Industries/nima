import * as Cause from "effect/Cause";
import { expect, it } from "vite-plus/test";
import { formatEnvironmentQueryError } from "./query";

it("preserves messages from structured RPC failures and native errors", () => {
  expect(
    formatEnvironmentQueryError(
      Cause.fail({ message: "This server does not support workspaceReview.subscribe" }),
    ),
  ).toBe("This server does not support workspaceReview.subscribe");
  expect(formatEnvironmentQueryError(Cause.fail(new Error("Connection closed")))).toBe(
    "Connection closed",
  );
  expect(formatEnvironmentQueryError(Cause.fail(null))).toBe("The environment request failed.");
});
