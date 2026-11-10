import { useState } from "react";
import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { render } from "../../test/render";
import { assistantFocusHandlers } from "./assistantFocus";

function Assistant() {
  const [home, setHome] = useState(true);
  const [draft, setDraft] = useState("");
  return (
    <div data-chat-column>
      <p>Earlier today</p>
      {home && <h1>What are we working on?</h1>}
      <div
        {...assistantFocusHandlers({
          enabled: true,
          home,
          canReturnHome: true,
          hasDraft: draft.trim() !== "",
          onEnter: () => setHome(false),
          onLeave: () => setHome(true),
        })}
      >
        <textarea
          aria-label="Message"
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        {home && (
          <nav data-bara-home-actions>
            <button>Check inbox</button>
          </nav>
        )}
      </div>
    </div>
  );
}

it("enters Focus from the composer, returns Home when left empty, and keeps a written draft", async () => {
  await using screen = await render(<Assistant />);
  const heading = screen.getByRole("heading", { name: "What are we working on?" });
  const message = screen.getByRole("textbox", { name: "Message" });

  // Opening the conversation focuses the composer without leaving Home.
  await expect.element(message).toHaveFocus();
  await expect.element(heading).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Check inbox" }));
  await expect.element(heading).toBeVisible();

  await userEvent.click(message);
  await expect.element(heading).not.toBeInTheDocument();
  await userEvent.click(screen.getByText("Earlier today"));
  await expect.element(heading).toBeVisible();

  await userEvent.type(message, "Plan my week");
  await expect.element(heading).not.toBeInTheDocument();
  await userEvent.click(screen.getByText("Earlier today"));
  await expect.element(heading).not.toBeInTheDocument();
  await expect.element(message).toHaveValue("Plan my week");
});
