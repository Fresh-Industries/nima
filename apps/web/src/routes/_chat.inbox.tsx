import { createFileRoute } from "@tanstack/react-router";
import { ConversationList } from "../nima/Workspace";

export const Route = createFileRoute("/_chat/inbox")({
  component: () => <ConversationList inbox />,
});
