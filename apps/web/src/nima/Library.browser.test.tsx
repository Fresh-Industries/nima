import { expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import { render } from "../../test/render";
import { Library } from "./Library";
import { useWorkspacePages } from "./useWorkspacePages";

vi.mock("./useWorkspacePages", () => ({ useWorkspacePages: vi.fn() }));

it("shows the empty Library after its first snapshot while the live subscription remains pending", async () => {
  vi.mocked(useWorkspacePages)
    .mockReset()
    .mockReturnValue({
      environmentId: EnvironmentId.make("library-test"),
      connected: true,
      drafts: {},
      canEdit: true,
      creationUnavailableReason: null,
      canCreate: true,
      query: {
        data: { pages: [], page: null, nextCursor: null },
        dataUpdatedAt: 1,
        isPending: true,
        isSuccess: true,
        error: null,
        failure: null,
        refresh: vi.fn(),
      },
      add: vi.fn(),
      edit: vi.fn(),
      resolve: vi.fn(),
      status: () => "Saved to Bara",
      save: vi.fn(),
    });
  await using screen = await render(<Library />);
  await expect
    .element(screen.getByRole("heading", { name: "No documents", exact: true }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("heading", { name: "Loading documents…", exact: true }))
    .not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("button", { name: "New document", exact: true }))
    .toBeEnabled();
});
