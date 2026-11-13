import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceInbox } from "../nima/Inbox";
import { ConversationList } from "../nima/Workspace";

// The Inbox is the Desk's "To review" view; the route keeps its links working.
export const Route = createFileRoute("/_chat/inbox")({
  component: () => <ConversationList review={<WorkspaceInbox />} />,
});
