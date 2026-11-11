import { create } from "zustand";
import { useEffect } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
export const useLiveActivity = create<{
  hosts: Record<
    string,
    {
      environmentId: EnvironmentId;
      recording: boolean;
      broadcast: boolean;
      capture: boolean;
      /** When the current recording or broadcast began, for elapsed time. */
      since: number | null;
    }
  >;
}>(() => ({ hosts: {} }));
function setLiveActivity(
  environmentId: EnvironmentId,
  recording: boolean,
  broadcast: boolean,
  capture = false,
) {
  useLiveActivity.setState((state) => {
    const hosts = { ...state.hosts };
    const previous = hosts[environmentId];
    const onAir = recording || broadcast;
    if (recording || broadcast || capture)
      hosts[environmentId] = {
        environmentId,
        recording,
        broadcast,
        capture,
        since: onAir ? (previous?.since ?? Date.now()) : null,
      };
    else delete hosts[environmentId];
    return { hosts };
  });
}

export function usePublishLiveActivity(
  environmentId: EnvironmentId | null,
  recording: boolean,
  broadcast: boolean,
  capture: boolean,
) {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- publishes the mounted Live workspace's media activity to navigation
  useEffect(() => {
    if (!environmentId) return;
    setLiveActivity(environmentId, recording, broadcast, capture);
  }, [environmentId, recording, broadcast, capture]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- only releasing a media workspace removes its host; source updates must preserve the recording clock
  useEffect(() => {
    if (!environmentId) return;
    return () => setLiveActivity(environmentId, false, false);
  }, [environmentId]);
}
