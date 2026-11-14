import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { render } from "../../test/render";
import { WorkProposalCard } from "./WorkProposalCard";

it("lets you edit or dismiss a suggested session before anything starts", async () => {
  await using screen = await render(
    <WorkProposalCard
      streaming={false}
      code='{"title":"Launch email","objective":"Draft the Spore Folks launch email.","bot":"","goal":"Fivelo launch"}'
    />,
  );
  await expect.element(screen.getByText("Suggested session · for Fivelo launch")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
  await userEvent.fill(screen.getByRole("textbox", { name: "Session name" }), "Launch note");
  await userEvent.click(screen.getByRole("button", { name: "Done" }));
  await expect.element(screen.getByText("Launch note", { exact: true })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  await expect.element(screen.getByText("Launch note", { exact: true })).not.toBeInTheDocument();
});
