import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceInbox } from "../nima/Inbox";

export const Route = createFileRoute("/_chat/inbox")({
  component: () => <WorkspaceInbox />,
});
