import { useEffect, useState } from "react";
import {
  composerDraftHasUserContent,
  useComposerDraftStore,
  type ComposerThreadTarget,
} from "../composerDraftStore";
import { useStableCallback } from "../hooks/useStableCallback";
import { ComposerBanner } from "../components/chat/ComposerBanner";
import { Button } from "../components/ui/button";
import { useConversationHandoffStore } from "./conversationHandoff";

export function ConversationHandoff({
  active,
  target,
  targetKey,
  ready,
  unavailable = false,
  onSend,
}: {
  active: boolean;
  target: ComposerThreadTarget;
  targetKey: string;
  ready: boolean;
  unavailable?: boolean;
  onSend: () => void | Promise<void>;
}) {
  const request = useConversationHandoffStore((state) => state.request);
  const draft = useComposerDraftStore((state) => state.getComposerDraft(target));
  const send = useStableCallback(onSend);
  const [previousRequest] = useState(() => {
    const pending = useConversationHandoffStore.getState().request;
    return pending?.targetKey ? pending.id : null;
  });
  const blockedByDraft =
    request?.phase === "pending" &&
    request.targetKey === targetKey &&
    draft &&
    composerDraftHasUserContent(draft);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- delivers a user-requested goal prompt to the mounted assistant through its existing composer and send pipeline
  useEffect(() => {
    if (!active || !request) return;
    const handoff = useConversationHandoffStore.getState();
    if (handoff.request?.id !== request.id) return;
    if (request.targetKey === null) {
      handoff.claim(request.id, targetKey);
      return;
    }
    if (request.targetKey !== targetKey) return;
    if (previousRequest === request.id) {
      handoff.dismiss(request.id);
      return;
    }
    if (request.phase === "pending") {
      const current = useComposerDraftStore.getState().getComposerDraft(target);
      if (current && composerDraftHasUserContent(current)) return;
      useComposerDraftStore.getState().setPrompt(target, request.prompt);
      handoff.place(request.id, targetKey);
      return;
    }
    if (draft?.prompt !== request.prompt || unavailable) {
      handoff.dismiss(request.id);
      return;
    }
    if (!ready) return;
    handoff.dismiss(request.id);
    void send();
  }, [active, request, draft, target, targetKey, ready, unavailable, previousRequest, send]);

  if (!active || !request || !blockedByDraft) return null;
  return (
    <ComposerBanner.Root role="status" variant="info" detached density="comfortable">
      <ComposerBanner.Row layout="wrap-actions">
        <ComposerBanner.Content>
          Your unsent message is kept. Your request is ready.
        </ComposerBanner.Content>
        <ComposerBanner.Actions>
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              const current = useComposerDraftStore.getState().getComposerDraft(target);
              useComposerDraftStore
                .getState()
                .setPrompt(target, [current?.prompt, request.prompt].filter(Boolean).join("\n\n"));
              useConversationHandoffStore.getState().dismiss(request.id);
            }}
          >
            Add to draft
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => useConversationHandoffStore.getState().dismiss(request.id)}
          >
            Dismiss
          </Button>
        </ComposerBanner.Actions>
      </ComposerBanner.Row>
    </ComposerBanner.Root>
  );
}
