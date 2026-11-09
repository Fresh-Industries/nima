import { expect, it, vi } from "vite-plus/test";
import { render } from "../../test/render";
import { useAssistantDayWindow } from "./useAssistantDayWindow";

const clock = vi.hoisted(() => ({ day: "2026-11-09" }));
vi.mock("./useDay", () => ({ useDay: () => clock.day }));
vi.mock("./usePersonalAssistant", () => ({
  usePersonalAssistant: () => ({ config: { timezone: "America/Chicago" } }),
}));
const row = (id: string, createdAt: string) => ({ id, createdAt });

it("reveals previous assistant days through paginated history, preserves newer rows, and folds again on a different conversation", async () => {
  clock.day = "2026-11-09";
  const load = vi.fn();
  const today = row("Today’s message", "2026-11-09T14:00:00Z");
  const earlierToday = row("Earlier today", "2026-11-09T10:00:00Z");
  const yesterday = row("Yesterday’s message", "2026-11-08T22:00:00Z");
  const oldest = row("Two days ago", "2026-11-07T22:00:00Z");
  function Conversation({
    entries,
    threadKey = "home",
  }: {
    entries: ReturnType<typeof row>[];
    threadKey?: string;
  }) {
    const day = useAssistantDayWindow({
      enabled: true,
      threadKey,
      entries,
      history: { hasMoreHistory: true, loading: false, error: null, onLoadEarlier: load },
      searching: false,
    });
    return (
      <main>
        {day.historyHeader}
        {day.entries.map((entry) => (
          <p key={entry.id}>{entry.id}</p>
        ))}
      </main>
    );
  }
  await using screen = await render(<Conversation entries={[today]} />);
  await screen.getByRole("button", { name: "View previous day", exact: true }).click();
  expect(load).toHaveBeenCalledTimes(1);
  await screen.rerender(<Conversation entries={[earlierToday, today]} />);
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  await screen.rerender(<Conversation entries={[oldest, yesterday, earlierToday, today]} />);
  await expect.element(screen.getByText("Yesterday’s message", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("Today’s message", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("Two days ago", { exact: true })).not.toBeInTheDocument();
  await screen.rerender(
    <Conversation entries={[oldest, yesterday, earlierToday, today]} threadKey="another-home" />,
  );
  await expect
    .element(screen.getByText("Yesterday’s message", { exact: true }))
    .not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("button", { name: "View previous day", exact: true }))
    .toBeEnabled();
  clock.day = "2026-11-10";
  await screen.rerender(
    <Conversation entries={[oldest, yesterday, earlierToday, today]} threadKey="another-home" />,
  );
  await expect
    .element(screen.getByText("Today’s message", { exact: true }))
    .not.toBeInTheDocument();
  await screen.getByRole("button", { name: "View previous day", exact: true }).click();
  await expect.element(screen.getByText("Today’s message", { exact: true })).toBeVisible();
});
