import { expect, it } from "vite-plus/test";
import { parseWorkProposal } from "./workProposal";

it("reads a complete proposal and refuses partial or foreign blocks", () => {
  expect(
    parseWorkProposal('{"title":" Launch email ","objective":"Draft it","bot":"Growth"}'),
  ).toEqual({ title: "Launch email", objective: "Draft it", bot: "Growth", goal: "" });
  // Still streaming, missing its objective, or not JSON at all.
  for (const code of ['{"title":"Launch', '{"title":"Launch email"}', "npm install"])
    expect(parseWorkProposal(code)).toBeNull();
});
