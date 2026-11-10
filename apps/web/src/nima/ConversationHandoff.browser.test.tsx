import { StrictMode } from "react";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { expect, it, vi } from "vite-plus/test";
import { act, render } from "../../test/render";
import { useComposerDraftStore } from "../composerDraftStore";
import { randomUUID } from "../lib/utils";
import { ConversationHandoff } from "./ConversationHandoff";
import { goalConversationPrompt } from "./goalConversation";
import { useConversationHandoffStore } from "./conversationHandoffStore";
import { BOT_CREATION_PROMPT } from "./botConversation";

function setup() {
  useConversationHandoffStore.setState({ request: null });
  const target = scopeThreadRef(EnvironmentId.make("goal-chat-test"), ThreadId.make(randomUUID()));
  return { target, targetKey: scopedThreadKey(target) };
}

it("delivers a bot request through the assistant composer once, including under Strict Mode", async () => {
  const { target, targetKey } = setup();
  const prompt = BOT_CREATION_PROMPT;
  useConversationHandoffStore.getState().begin(prompt);
  const sent: string[] = [];
  const onSend = () => {
    sent.push(useComposerDraftStore.getState().getComposerDraft(target)?.prompt ?? "");
  };
  await using screen = await render(
    <StrictMode>
      <ConversationHandoff active target={target} targetKey={targetKey} ready onSend={onSend} />
    </StrictMode>,
  );
  await vi.waitFor(() => expect(sent).toEqual([prompt]));
  await screen.rerender(
    <StrictMode>
      <ConversationHandoff active target={target} targetKey={targetKey} ready onSend={onSend} />
    </StrictMode>,
  );
  expect(sent).toEqual([prompt]);
  expect(useConversationHandoffStore.getState().request).toBeNull();
});

it("preserves an existing unsent draft and requires an explicit merge without sending it", async () => {
  const { target, targetKey } = setup();
  const original = "An unfinished message I have not sent.";
  useComposerDraftStore.getState().setPrompt(target, original);
  const prompt = goalConversationPrompt("Interests");
  useConversationHandoffStore.getState().begin(prompt);
  const onSend = vi.fn();
  await using screen = await render(
    <ConversationHandoff active target={target} targetKey={targetKey} ready onSend={onSend} />,
  );
  expect(useComposerDraftStore.getState().getComposerDraft(target)?.prompt).toBe(original);
  expect(onSend).not.toHaveBeenCalled();
  await screen.getByRole("button", { name: "Add to draft" }).click();
  expect(useComposerDraftStore.getState().getComposerDraft(target)?.prompt).toBe(
    `${original}\n\n${prompt}`,
  );
  expect(onSend).not.toHaveBeenCalled();
  expect(useConversationHandoffStore.getState().request).toBeNull();
});

it("waits for the assistant view and leaves a normal draft when sending is unavailable", async () => {
  const { target, targetKey } = setup();
  const prompt = goalConversationPrompt(null);
  useConversationHandoffStore.getState().begin(prompt);
  const onSend = vi.fn();
  await using screen = await render(
    <ConversationHandoff
      active={false}
      target={target}
      targetKey={targetKey}
      ready={false}
      unavailable
      onSend={onSend}
    />,
  );
  expect(useComposerDraftStore.getState().getComposerDraft(target)?.prompt ?? "").toBe("");
  await screen.rerender(
    <ConversationHandoff
      active
      target={target}
      targetKey={targetKey}
      ready={false}
      unavailable
      onSend={onSend}
    />,
  );
  await vi.waitFor(() =>
    expect(useComposerDraftStore.getState().getComposerDraft(target)?.prompt).toBe(prompt),
  );
  expect(onSend).not.toHaveBeenCalled();
  expect(useConversationHandoffStore.getState().request).toBeNull();
  await act(() => {
    useComposerDraftStore.getState().setPrompt(target, "Edited by the user");
  });
  await screen.rerender(
    <ConversationHandoff active target={target} targetKey={targetKey} ready onSend={onSend} />,
  );
  expect(onSend).not.toHaveBeenCalled();
  expect(useComposerDraftStore.getState().getComposerDraft(target)?.prompt).toBe(
    "Edited by the user",
  );
});

it("keeps a placed goal request while the composer prepares, then sends it once ready", async () => {
  const { target, targetKey } = setup();
  const prompt = goalConversationPrompt("Health");
  useConversationHandoffStore.getState().begin(prompt);
  const onSend = vi.fn();
  await using screen = await render(
    <ConversationHandoff
      active
      target={target}
      targetKey={targetKey}
      ready={false}
      onSend={onSend}
    />,
  );
  await vi.waitFor(() =>
    expect(useConversationHandoffStore.getState().request?.phase).toBe("placed"),
  );
  expect(onSend).not.toHaveBeenCalled();
  await screen.rerender(
    <ConversationHandoff active target={target} targetKey={targetKey} ready onSend={onSend} />,
  );
  await vi.waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
  expect(useComposerDraftStore.getState().getComposerDraft(target)?.prompt).toBe(prompt);
});

it("does not auto-send an old request when returning to the conversation later", async () => {
  const { target, targetKey } = setup();
  const prompt = goalConversationPrompt("Career");
  useConversationHandoffStore.getState().begin(prompt);
  const onSend = vi.fn();
  await using first = await render(
    <ConversationHandoff
      active
      target={target}
      targetKey={targetKey}
      ready={false}
      onSend={onSend}
    />,
  );
  await vi.waitFor(() =>
    expect(useConversationHandoffStore.getState().request?.phase).toBe("placed"),
  );
  await first.unmount();
  await using _returned = await render(
    <ConversationHandoff active target={target} targetKey={targetKey} ready onSend={onSend} />,
  );
  await vi.waitFor(() => expect(useConversationHandoffStore.getState().request).toBeNull());
  expect(onSend).not.toHaveBeenCalled();
  expect(useComposerDraftStore.getState().getComposerDraft(target)?.prompt).toBe(prompt);
});
