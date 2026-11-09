import { expect, it, vi } from "vite-plus/test";
import { render } from "../../test/render";
import { BaraUpdates } from "./BaraUpdates";

vi.mock("../state/desktopUpdate", () => ({ useDesktopUpdateState: () => null }));
vi.mock("../state/managedPolicy", () => ({ usePrimaryManagedPolicy: () => undefined }));

it("checks the live build, offers a reload only when its entry changes, and reports a failed check", async () => {
  const entry = document.querySelector('script[type="module"][src]')?.getAttribute("src");
  expect(entry).toBeTruthy();
  await using screen = await render(<BaraUpdates />);
  const actualFetch = globalThis.fetch.bind(globalThis);
  const response = vi.fn(
    async () => new Response(`<script type="module" src="${entry}"></script>`),
  );
  using _request = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation((input, init) =>
      String(input).includes("bara-update-check=") ? response() : actualFetch(input, init),
    );
  await screen.getByRole("button", { name: "Check for Updates", exact: true }).click();
  await expect.element(screen.getByRole("status")).toHaveTextContent("You’re up to date.");
  await expect
    .element(screen.getByRole("button", { name: "Reload Bara", exact: true }))
    .not.toBeInTheDocument();
  response.mockResolvedValueOnce(
    new Response('<script type="module" src="/assets/bara-new-build.js"></script>'),
  );
  await screen.getByRole("button", { name: "Check for Updates", exact: true }).click();
  await expect
    .element(screen.getByRole("button", { name: "Reload Bara", exact: true }))
    .toBeVisible();
  response.mockRejectedValueOnce(new Error("Connection unavailable"));
  await screen.getByRole("button", { name: "Check for Updates", exact: true }).click();
  await expect.element(screen.getByRole("status")).toHaveTextContent("Connection unavailable");
  await expect
    .element(screen.getByRole("button", { name: "Check for Updates", exact: true }))
    .toBeEnabled();
});

it("checks Bara’s release repository when the desktop has no native feed, without treating an unpublished release as current", async () => {
  const previous = Object.getOwnPropertyDescriptor(window, "desktopBridge");
  Object.defineProperty(window, "desktopBridge", { configurable: true, value: {} });
  try {
    await using screen = await render(<BaraUpdates />);
    const actualFetch = globalThis.fetch.bind(globalThis);
    using request = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input, init) =>
        String(input).includes("api.github.com/repos/Fresh-Industries/nima/releases/latest")
          ? Promise.resolve(new Response("", { status: 404 }))
          : actualFetch(input, init),
      );
    await screen.getByRole("button", { name: "Check for Updates", exact: true }).click();
    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent("No Bara release has been published yet.");
    expect(
      request.mock.calls.some(
        ([url]) => url === "https://api.github.com/repos/Fresh-Industries/nima/releases/latest",
      ),
    ).toBe(true);
  } finally {
    if (previous) Object.defineProperty(window, "desktopBridge", previous);
    else Reflect.deleteProperty(window, "desktopBridge");
  }
});
