import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useComposerDraftStore } from "../composerDraftStore";
import { useStableCallback } from "../hooks/useStableCallback";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { useNimaStore } from "./store";
import { usePersonalAssistant } from "./usePersonalAssistant";

/**
 * Resolves the server-owned Assistant conversation, opening (and migrating a legacy one into)
 * it once the primary connection is ready.
 */
export function useAssistantThread() {
  const assistant = usePersonalAssistant();
  const canOpen = useAtomValue(
    serverEnvironment.openPersonalAgent.permissionAtom(assistant.environmentId),
  );
  const open = useAtomCommand(serverEnvironment.openPersonalAgent, { reportFailure: false });
  const opening = useRef(false);
  const [opened, setOpened] = useState<ThreadId | null>(null);
  const [error, setError] = useState("");
  const resolve = useStableCallback(async () => {
    if (opening.current || !assistant.connected || !assistant.environmentId || !assistant.profile)
      return;
    const environmentId = assistant.environmentId;
    opening.current = true;
    setError("");
    let threadId = assistant.profile.threadId;
    if (canOpen) {
      const legacy = useNimaStore.getState().assistantConversation;
      const result = await open({
        environmentId,
        input: {
          legacyConfig: assistant.legacy,
          ...(legacy?.environmentId === environmentId ? { legacyThreadId: legacy.threadId } : {}),
        },
      });
      if (result._tag !== "Success") {
        const cause = squashAtomCommandFailure(result);
        setError(cause instanceof Error ? cause.message : "Could not open your assistant.");
        opening.current = false;
        return;
      }
      threadId = result.value.threadId;
      if (threadId && legacy?.environmentId === environmentId) {
        const drafts = useComposerDraftStore.getState();
        const pending = drafts.getDraftSession(legacy.draftId);
        if (pending && !pending.promotedTo)
          drafts.moveComposerPromptAndImages(
            legacy.draftId,
            scopeThreadRef(environmentId, threadId),
          );
      }
    }
    if (!threadId) setError("Ask the workspace owner to initialize the personal assistant.");
    else setOpened(threadId);
    opening.current = false;
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- resolves the server-owned canonical conversation after the primary connection becomes ready
  useEffect(() => {
    if (assistant.connected && assistant.profile) void resolve();
  }, [assistant.connected, assistant.profile, resolve]);
  const threadId = assistant.profile?.threadId ?? opened;
  return {
    assistant,
    threadRef:
      threadId && assistant.environmentId
        ? scopeThreadRef(assistant.environmentId, threadId)
        : null,
    error: error || (assistant.query.error ? String(assistant.query.error) : ""),
    retry: () => {
      assistant.query.refresh();
      void resolve();
    },
  };
}

/** Opens the Assistant's full-screen conversation, for flows that hand it a prompt. */
export function useOpenAssistant() {
  const { environmentId, profile } = usePersonalAssistant();
  const navigate = useNavigate();
  return () =>
    profile?.threadId && environmentId
      ? navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId, threadId: profile.threadId },
        })
      : navigate({ to: "/" });
}
