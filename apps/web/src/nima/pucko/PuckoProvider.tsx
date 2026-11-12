import { createContext, use, useEffect, useState, type ReactNode } from "react";
import { useAtomValue } from "@effect/atom-react";
import { Link, useLocation } from "@tanstack/react-router";
import {
  initialMeetingState,
  MeetingController,
  type MeetingState,
} from "@t3tools/client-runtime/meetings";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { BotId, EnvironmentId, ProjectId } from "@t3tools/contracts";
import { Button } from "../../components/ui/button";
import { useEnvironment } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { randomUUID } from "../../lib/utils";
import { BrowserMeetingDevice } from "../meetings/browserDevice";

type Host = {
  controller: MeetingController | null;
  environmentId: EnvironmentId | null;
  state: MeetingState;
};
const PuckoContext = createContext<{
  host: Host;
  start: (
    environmentId: EnvironmentId,
    activationName: string,
    scope: { projectId: ProjectId | null; coordinatorBotId: BotId | null },
  ) => Promise<void>;
} | null>(null);
export function usePucko() {
  const context = use(PuckoContext);
  if (!context) throw new Error("Pucko requires its workspace host.");
  return context;
}

export function PuckoProvider({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<Host>({
    controller: null,
    environmentId: null,
    state: initialMeetingState,
  });
  const command = useAtomCommand(serverEnvironment.meetingExperiment, { reportFailure: false });
  const environment = useEnvironment(host.environmentId);
  const allowed = useAtomValue(
    serverEnvironment.meetingExperiment.permissionAtom(host.environmentId),
  );
  const query = useEnvironmentQuery(
    host.environmentId && environment?.serverConfig?.environment.capabilities.pucko
      ? serverEnvironment.puckoLive({ environmentId: host.environmentId, input: {} })
      : null,
  );
  const meeting = query.data?.meetings.find((entry) => entry.id === host.controller?.id);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Persisted task and summary events feed the active voice controller across route changes.
  useEffect(() => {
    if (meeting) host.controller?.observe(meeting);
  }, [host.controller, meeting]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- The workspace owns capture until explicit End, window shutdown, or permission/connection loss.
  useEffect(() => {
    const stop = () => host.controller?.dispose();
    window.addEventListener("pagehide", stop);
    return () => {
      window.removeEventListener("pagehide", stop);
      host.controller?.dispose();
    };
  }, [host.controller]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Losing the destination's execution permission or connection stops local capture immediately.
  useEffect(() => {
    if (
      host.controller &&
      ["connecting", "listening"].includes(host.state.phase) &&
      (!allowed || environment?.connection.phase !== "connected")
    )
      void host.controller.end();
  }, [host.controller, host.state.phase, allowed, environment?.connection.phase]);
  const start = async (
    environmentId: EnvironmentId,
    activationName: string,
    scope: { projectId: ProjectId | null; coordinatorBotId: BotId | null },
  ) => {
    if (host.controller && ["connecting", "listening"].includes(host.state.phase)) return;
    const controller = new MeetingController(
      randomUUID(),
      new BrowserMeetingDevice(),
      async (input) => {
        const result = await command({ environmentId, input });
        if (result._tag !== "Success") throw squashAtomCommandFailure(result);
        return result.value;
      },
      (state) =>
        setHost((previous) =>
          previous.controller === controller ? { ...previous, state } : previous,
        ),
      randomUUID,
      activationName,
    );
    setHost({ controller, environmentId, state: initialMeetingState });
    await controller.start(true, scope);
  };
  const pathname = useLocation({ select: (location) => location.pathname });
  const active = host.state.phase === "connecting" || host.state.phase === "listening";
  return (
    <PuckoContext value={{ host, start }}>
      {children}
      {active && pathname !== "/pucko" && (
        <div
          className="fixed bottom-4 left-20 z-50 flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-2 text-sm shadow-lg"
          role="status"
        >
          <Link to="/pucko">
            Pucko ·{" "}
            {host.state.muted
              ? "Microphone muted"
              : host.state.phase === "connecting"
                ? "Connecting"
                : "Microphone on"}
          </Link>
          <Button size="xs" variant="ghost" onClick={() => void host.controller?.end()}>
            End
          </Button>
        </div>
      )}
    </PuckoContext>
  );
}
