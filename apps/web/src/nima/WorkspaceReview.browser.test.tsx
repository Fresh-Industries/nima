import { Atom, AsyncResult } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { render } from "../../test/render";
import { useWorkspaceReview } from "./useWorkspaceReview";

const calls = vi.hoisted(() => ({ review: vi.fn(), bots: vi.fn() }));
vi.mock("../state/entities", () => ({ useVisibleThreadShells: () => [] }));
vi.mock("../state/environments", () => ({
  useEnvironments: () => ({
    environments: [
      {
        environmentId: "bara",
        label: "Zeus",
        connection: { phase: "connected" },
        serverConfig: { environment: { capabilities: { botCapabilities: true } } },
      },
      {
        environmentId: "t3",
        label: "fresh-server",
        connection: { phase: "connected" },
        serverConfig: { environment: { capabilities: {} } },
      },
      {
        environmentId: "disabled",
        label: "Explicitly disabled",
        connection: { phase: "connected" },
        serverConfig: {
          environment: { capabilities: { botCapabilities: true, workspaceReview: false } },
        },
      },
    ],
  }),
}));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("../state/server", () => ({
  serverEnvironment: {
    workspaceReviewLive: (request: unknown) => {
      calls.review(request);
      return Atom.make(AsyncResult.success({ metadata: [], items: [], pendingCount: 0 }));
    },
    botsLive: (request: unknown) => {
      calls.bots(request);
      return Atom.make(AsyncResult.success({ approvals: [] }));
    },
    writeWorkspaceReview: { permissionAtom: () => Atom.make(true) },
  },
}));
it("only requests Bara review APIs from hosts that advertise support, including older Bara hosts", async () => {
  function Work() {
    const review = useWorkspaceReview();
    return <main>{review.errors.length ? review.errors.join(",") : "Work ready"}</main>;
  }
  await using screen = await render(<Work />);
  await expect.element(screen.getByText("Work ready", { exact: true })).toBeVisible();
  expect(calls.review).toHaveBeenCalledWith({
    environmentId: "bara",
    input: { threadIds: [], view: "review" },
  });
  expect(calls.review).not.toHaveBeenCalledWith(expect.objectContaining({ environmentId: "t3" }));
  expect(calls.review).not.toHaveBeenCalledWith(
    expect.objectContaining({ environmentId: "disabled" }),
  );
  expect(calls.bots).not.toHaveBeenCalledWith(expect.objectContaining({ environmentId: "t3" }));
});
