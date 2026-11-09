import { create } from "zustand";
import type { EnvironmentId } from "@t3tools/contracts";
export const useLiveActivity = create<{
  hosts: Record<
    string,
    { environmentId: EnvironmentId; recording: boolean; broadcast: boolean; capture: boolean }
  >;
}>(() => ({ hosts: {} }));
export function setLiveActivity(
  environmentId: EnvironmentId,
  recording: boolean,
  broadcast: boolean,
  capture = false,
) {
  useLiveActivity.setState((state) => {
    const hosts = { ...state.hosts };
    if (recording || broadcast || capture)
      hosts[environmentId] = { environmentId, recording, broadcast, capture };
    else delete hosts[environmentId];
    return { hosts };
  });
}
