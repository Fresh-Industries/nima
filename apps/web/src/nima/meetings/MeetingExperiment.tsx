import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import { MeetingController, type MeetingState } from "@t3tools/client-runtime/meetings";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
} from "../../components/ui/dialog";
import { isElectron } from "../../env";
import { randomUUID } from "../../lib/utils";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { BrowserMeetingDevice } from "./browserDevice";
import { useComposerDraftStore } from "../../composerDraftStore";

export function MeetingExperimentButton({
  threadRef,
  connected,
}: {
  threadRef: ScopedThreadRef;
  connected: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!isElectron && !import.meta.env.DEV) return null;
  return (
    <>
      <Button size="xs" variant="ghost" onClick={() => setOpen(true)}>
        Meeting trial
      </Button>
      {open && (
        <MeetingTrial threadRef={threadRef} connected={connected} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function MeetingTrial({
  threadRef,
  connected,
  onClose,
}: {
  threadRef: ScopedThreadRef;
  connected: boolean;
  onClose: () => void;
}) {
  const allowed = useAtomValue(
    serverEnvironment.meetingExperiment.permissionAtom(threadRef.environmentId),
  );
  const command = useAtomCommand(serverEnvironment.meetingExperiment, { reportFailure: false });
  const [state, setState] = useState<MeetingState>({
    phase: "idle",
    transcript: "",
    candidate: "",
    error: "",
    previewing: false,
    previewTranscript: "",
    hasPreview: false,
    result: null,
  });
  const [controller] = useState(
    () =>
      new MeetingController(
        randomUUID(),
        new BrowserMeetingDevice(),
        async (input) => {
          const result = await command({ environmentId: threadRef.environmentId, input });
          if (result._tag !== "Success") throw squashAtomCommandFailure(result);
          return result.value;
        },
        setState,
        randomUUID,
      ),
  );
  const [consent, setConsent] = useState(false);
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const start = () => {
    const draft = useComposerDraftStore.getState().getComposerDraft(threadRef);
    const selection = draft?.activeProvider
      ? draft.modelSelectionByProvider[draft.activeProvider]
      : undefined;
    return controller.start(threadRef.threadId, consent, {
      ...(selection ? { modelSelection: selection } : {}),
      ...(draft?.runtimeMode ? { runtimeMode: draft.runtimeMode } : {}),
      ...(draft?.interactionMode ? { interactionMode: draft.interactionMode } : {}),
    });
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- The device must release its microphone on navigation, unmount, or window shutdown.
  useEffect(() => {
    const stop = () => controller.dispose();
    window.addEventListener("pagehide", stop);
    return () => {
      window.removeEventListener("pagehide", stop);
      controller.dispose();
    };
  }, [controller]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Revoked or disconnected environment permissions must immediately stop local capture.
  useEffect(() => {
    if ((state.phase === "connecting" || state.phase === "listening") && (!allowed || !connected))
      void controller.end();
  }, [allowed, connected, controller, state.phase]);
  const run = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    await Promise.resolve()
      .then(operation)
      .finally(() => setBusy(false));
  };
  const close = () => {
    controller.dispose();
    onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Citrus meeting trial</DialogTitle>
          <DialogDescription>
            Use a new Work session. Its coordinator, project, model and access level apply. This
            experiment requires reviewed requests and reviewed audio playback.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-4">
            <p role="status">
              Microphone:{" "}
              {state.phase === "listening"
                ? "capturing and sending to OpenAI"
                : state.phase === "connecting"
                  ? "preparing connection"
                  : "off"}
            </p>
            {state.phase === "idle" && (
              <>
                <label className="flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(event) => setConsent(event.target.checked)}
                  />
                  Everyone present consents to sending meeting audio to OpenAI and saving reviewed
                  requests and notes in this Work conversation.
                </label>
                <p className="text-xs text-muted-foreground">
                  Transcript and optional voice preview stay in this window until submitted. OpenAI
                  recording storage is disabled. Closing this window stops capture. Background Work
                  continues.
                </p>
                <Button
                  disabled={!consent || !allowed || !connected || busy}
                  onClick={() => void run(start)}
                >
                  Start meeting
                </Button>
              </>
            )}
            {(state.phase === "connecting" || state.phase === "listening") && (
              <div className="flex gap-2">
                <Button variant="destructive" onClick={() => void controller.end()}>
                  Mute and end capture
                </Button>
                <Button variant="outline" onClick={() => controller.stopPlayback()}>
                  Stop playback
                </Button>
              </div>
            )}
            <details open>
              <summary>Live transcript</summary>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs">
                {state.transcript || "No speech transcribed."}
              </pre>
            </details>
            {state.phase === "listening" && (
              <>
                <p className="text-xs text-muted-foreground">
                  Say “Citrus” and your question, then review the request below. Listening and voice
                  delegation events never start work automatically. Incomplete transcription may
                  need correction.
                </p>
                <Button variant="outline" size="sm" onClick={() => setRequest(state.candidate)}>
                  Use recent speech
                </Button>
                <label className="grid gap-2 text-sm">
                  Request for Citrus
                  <textarea
                    className="rounded-md border p-2"
                    rows={3}
                    maxLength={4000}
                    value={request}
                    onChange={(event) => setRequest(event.target.value)}
                  />
                </label>
                <Button
                  disabled={!allowed || busy || !request.trim()}
                  onClick={() => void run(() => controller.submit(request))}
                >
                  Send reviewed request
                </Button>
              </>
            )}
            {state.result && (
              <>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void run(() => controller.inspect())}
                  >
                    Refresh confirmed status
                  </Button>
                  {state.phase === "ended" && (
                    <Button
                      size="sm"
                      disabled={!allowed || busy}
                      onClick={() => void run(() => controller.prepareNotes())}
                    >
                      Prepare notes in Work
                    </Button>
                  )}
                </div>
                {state.result.requests.map((entry) => (
                  <div key={entry.requestId} className="space-y-2 border-t pt-2 text-sm">
                    <p>Agent turn: {entry.status}</p>
                    <p className="whitespace-pre-wrap">{entry.answer}</p>
                    {entry.answer && state.phase === "listening" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={state.previewing}
                        onClick={() => controller.beginPreview(entry.answer)}
                      >
                        Prepare voice preview
                      </Button>
                    )}
                  </div>
                ))}
                {state.result.tasks.map((task) => (
                  <p key={task.id} className="text-sm">
                    {task.title}: {task.status}
                    {task.threadId && (
                      <>
                        {" "}
                        ·{" "}
                        <Link
                          to="/$environmentId/$threadId"
                          params={{
                            environmentId: threadRef.environmentId,
                            threadId: task.threadId,
                          }}
                          onClick={close}
                        >
                          Open Work
                        </Link>
                      </>
                    )}
                  </p>
                ))}
              </>
            )}
            {state.previewing && (
              <Button variant="outline" onClick={() => void controller.finishPreview()}>
                Finish voice preview
              </Button>
            )}
            {(state.previewing || state.hasPreview) && (
              <>
                <p className="text-xs text-muted-foreground">
                  Review the generated words before playing this local audio clip. They may differ
                  from the verified answer; do not play an incorrect preview.
                </p>
                <p className="whitespace-pre-wrap text-sm">
                  {state.previewTranscript || "Waiting for voice transcript…"}
                </p>
                {state.hasPreview && (
                  <Button
                    disabled={!state.previewTranscript.trim()}
                    onClick={() => void controller.playReviewedPreview()}
                  >
                    Play reviewed preview
                  </Button>
                )}
              </>
            )}
            {state.phase === "ended" && (
              <p className="text-sm">
                Capture stopped. Notes and background tasks remain in the Work conversation. Refresh
                to see the backend-confirmed result.
              </p>
            )}
            {state.error && (
              <p role="alert" className="text-sm text-destructive">
                {state.error}
              </p>
            )}
            <Button variant="ghost" onClick={close}>
              Close trial
            </Button>
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
