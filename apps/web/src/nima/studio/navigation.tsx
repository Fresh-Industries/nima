import { createContext, use, useImperativeHandle, type RefObject } from "react";
import { useBlocker } from "@tanstack/react-router";
import type { EnvironmentId, StudioArea } from "@t3tools/contracts";
import { usePrimaryEnvironmentId } from "../../state/environments";

export type StudioLeaveGuard = { mayLeave: () => boolean };
export const StudioNavigationContext = createContext<{
  guard: RefObject<StudioLeaveGuard | null>;
  environmentId: EnvironmentId | null;
  area: StudioArea;
  id: string | undefined;
} | null>(null);

export function useStudioLeaveGuard(dirty: boolean, message: string) {
  const context = use(StudioNavigationContext);
  const primary = usePrimaryEnvironmentId();
  const mayLeave = () => !dirty || window.confirm(message);
  useImperativeHandle(context?.guard, () => ({ mayLeave }), [dirty, message]);
  useBlocker({
    shouldBlockFn: ({ next }) => {
      if (!context) return !mayLeave();
      const environmentId = "environmentId" in next.search ? next.search.environmentId : undefined;
      const area = "area" in next.search ? next.search.area : undefined;
      const id = "id" in next.search ? next.search.id : undefined;
      // Other destinations park this editor; another document on this host replaces it.
      if (next.pathname !== "/studio" || (environmentId ?? primary) !== context.environmentId)
        return false;
      return ((area ?? "design") !== context.area || id !== context.id) && !mayLeave();
    },
    enableBeforeUnload: dirty,
  });
}
