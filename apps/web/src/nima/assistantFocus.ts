import type { FocusEvent, KeyboardEvent, PointerEvent } from "react";

const HOME_ACTIONS = "[data-bara-home-actions]";
const fromHomeActions = (target: EventTarget) =>
  target instanceof Element && target.closest(HOME_ACTIONS) !== null;

/**
 * Assistant Home docks into Focus when the person reaches for the composer. Focus alone is not
 * enough, since the composer is focused programmatically when a conversation opens.
 */
export function assistantFocusHandlers(input: {
  enabled: boolean;
  home: boolean;
  /** Only a Focus that Home opened may fold back into Home. */
  canReturnHome: boolean;
  hasDraft: boolean;
  onEnter: () => void;
  onLeave: () => void;
}) {
  if (!input.enabled) return {};
  return {
    onPointerDownCapture: (event: PointerEvent) => {
      if (input.home && !fromHomeActions(event.target)) input.onEnter();
    },
    onKeyDownCapture: (event: KeyboardEvent) => {
      if (!input.home || event.metaKey || event.ctrlKey || event.altKey) return;
      if (fromHomeActions(event.target)) return;
      if (event.key.length === 1 || event.key === "Enter") input.onEnter();
    },
    onBlurCapture: (event: FocusEvent<HTMLElement>) => {
      if (input.home || !input.canReturnHome || input.hasDraft) return;
      const next = event.relatedTarget;
      // Menus and pickers render in portals, so only an empty click or a move within the chat
      // column counts as leaving the composer.
      if (next instanceof Node && event.currentTarget.contains(next)) return;
      if (next instanceof Element && !next.closest("[data-chat-column]")) return;
      input.onLeave();
    },
  };
}
