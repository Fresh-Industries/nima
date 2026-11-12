import type { MeetingExperimentCommand, MeetingExperimentResult } from "@t3tools/contracts";

export interface MeetingClip {
  play(): Promise<void>;
  stop(): void;
  dispose(): void;
}

/** Devices own media resources; meeting policy does not depend on Electron or browser APIs. */
export interface MeetingDevice {
  offer(
    onEvent: (event: unknown) => void,
    onFailure: (message: string) => void,
    signal: AbortSignal,
  ): Promise<string>;
  accept(sdp: string): Promise<void>;
  stopCapture(): void;
  close(): Promise<boolean>;
  beginPreview(text: string): void;
  finishPreview(): Promise<MeetingClip>;
}

export type MeetingState = {
  phase: "idle" | "connecting" | "listening" | "ended";
  transcript: string;
  candidate: string;
  error: string;
  previewing: boolean;
  previewTranscript: string;
  hasPreview: boolean;
  result: MeetingExperimentResult | null;
};

export class MeetingController {
  private state: MeetingState = {
    phase: "idle",
    transcript: "",
    candidate: "",
    error: "",
    previewing: false,
    previewTranscript: "",
    hasPreview: false,
    result: null,
  };
  private abort = new AbortController();
  private clip: MeetingClip | null = null;
  private events = new Set<string>();
  private request: Extract<MeetingExperimentCommand, { action: "invite" }> | null = null;
  private notes: Extract<MeetingExperimentCommand, { action: "notes" }> | null = null;
  private disposed = false;
  private started = false;
  private readonly id: string;
  private readonly device: MeetingDevice;
  private readonly command: (input: MeetingExperimentCommand) => Promise<MeetingExperimentResult>;
  private readonly changed: (state: MeetingState) => void;
  private readonly newId: () => string;

  constructor(
    id: string,
    device: MeetingDevice,
    command: (input: MeetingExperimentCommand) => Promise<MeetingExperimentResult>,
    changed: (state: MeetingState) => void,
    newId: () => string,
  ) {
    this.id = id;
    this.device = device;
    this.command = command;
    this.changed = changed;
    this.newId = newId;
  }

  private update(patch: Partial<MeetingState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.changed(this.state);
  }

  private fail(error: unknown) {
    this.update({ error: error instanceof Error ? error.message : "Meeting operation failed." });
  }

  async start(
    threadId: Extract<MeetingExperimentCommand, { action: "start" }>["threadId"],
    consent: boolean,
    configuration: Pick<
      Extract<MeetingExperimentCommand, { action: "start" }>,
      "modelSelection" | "runtimeMode" | "interactionMode"
    > = {},
  ) {
    if (!consent || this.state.phase !== "idle" || this.disposed) return;
    this.update({ phase: "connecting", error: "" });
    try {
      const sdp = await this.device.offer(
        (event) => this.receive(event),
        (message) => {
          this.halt();
          this.fail(new Error(message));
          void this.device.close();
        },
        this.abort.signal,
      );
      if (this.abort.signal.aborted) return;
      const result = await this.command({
        action: "start",
        id: this.id,
        threadId,
        consent: true,
        sdp,
        ...configuration,
      });
      this.started = true;
      if (this.abort.signal.aborted) {
        await this.command({ action: "close", id: this.id });
        return;
      }
      if (!result.sdp) throw new Error("Missing GPT-Live SDP answer.");
      await this.device.accept(result.sdp);
      if (!this.abort.signal.aborted) this.update({ result });
    } catch (error) {
      this.halt();
      this.fail(error);
      await this.device.close();
    }
  }

  receive(raw: unknown) {
    if (this.abort.signal.aborted || this.disposed || typeof raw !== "object" || raw === null)
      return;
    const event = raw as Record<string, unknown>;
    if (event.type === "session.started" && this.state.phase === "connecting")
      this.update({ phase: "listening" });
    if (event.type === "session.closed" || event.type === "error") {
      this.halt();
      this.fail(
        new Error(
          event.type === "error"
            ? "GPT-Live reported an error; capture stopped. Check project access and API compatibility."
            : "GPT-Live closed; capture stopped.",
        ),
      );
      void this.device.close();
      return;
    }
    if (
      event.type !== "session.input_transcript.delta" &&
      event.type !== "session.output_transcript.delta"
    )
      return;
    if (
      typeof event.event_id !== "string" ||
      typeof event.delta !== "string" ||
      typeof event.start_ms !== "number" ||
      typeof event.end_ms !== "number"
    )
      return;
    if (this.events.has(event.event_id)) return;
    if (
      this.events.size >= 10000 ||
      this.state.transcript.length + event.delta.length + 80 > 60000
    ) {
      this.halt();
      this.fail(
        new Error("Transcript limit reached. Capture stopped; save notes before another trial."),
      );
      void this.device.close();
      return;
    }
    this.events.add(event.event_id);
    if (event.type === "session.output_transcript.delta") {
      if (this.state.previewing)
        this.update({ previewTranscript: this.state.previewTranscript + event.delta });
      return;
    }
    this.clip?.stop();
    const transcript = `${this.state.transcript}[${event.start_ms}-${event.end_ms}ms] Participants: ${event.delta}\n`;
    // Detection only suggests text. An invitation or delegation event cannot submit a turn.
    const candidate = `${this.state.candidate}${event.delta}`.slice(-4000);
    this.update({ transcript, candidate });
  }

  async submit(request: string) {
    if (this.state.phase !== "listening" || this.disposed || !request.trim()) return;
    this.stopPlayback();
    if (!this.request || this.request.request !== request)
      this.request = {
        action: "invite",
        id: this.id,
        requestId: this.newId(),
        request,
        context: this.state.transcript,
      };
    try {
      const result = await this.command(this.request);
      this.request = null;
      this.update({ result, error: "", candidate: "" });
    } catch (error) {
      this.fail(error);
    }
  }

  async inspect() {
    if (!this.started || this.disposed) return;
    try {
      this.update({ result: await this.command({ action: "inspect", id: this.id }), error: "" });
    } catch (error) {
      this.fail(error);
    }
  }

  beginPreview(answer: string) {
    if (this.state.phase !== "listening" || this.disposed || this.state.previewing) return;
    if (
      !this.state.result?.requests.some(
        (request) => request.status === "completed" && request.answer === answer && answer,
      )
    )
      return;
    this.stopPlayback();
    try {
      const encoder = new TextEncoder();
      let text = "";
      let bytes = 0;
      for (const point of answer) {
        bytes += encoder.encode(point).length;
        if (bytes > 320) break;
        text += point;
      }
      this.device.beginPreview(text);
      this.update({ previewing: true, previewTranscript: "", hasPreview: false });
    } catch (error) {
      this.fail(error);
    }
  }

  async finishPreview() {
    if (!this.state.previewing || this.disposed) return;
    this.update({ previewing: false });
    try {
      const clip = await this.device.finishPreview();
      if (this.state.phase !== "listening" || this.disposed) {
        clip.dispose();
        return;
      }
      this.clip?.dispose();
      this.clip = clip;
      this.update({ hasPreview: true });
    } catch (error) {
      this.fail(error);
    }
  }

  async playReviewedPreview() {
    if (
      this.state.phase !== "listening" ||
      this.disposed ||
      !this.state.hasPreview ||
      !this.state.previewTranscript.trim()
    )
      return;
    try {
      await this.clip?.play();
    } catch (error) {
      this.fail(error);
    }
  }

  stopPlayback() {
    this.clip?.stop();
  }

  private halt() {
    this.abort.abort();
    this.device.stopCapture();
    this.clip?.dispose();
    this.clip = null;
    this.update({ phase: "ended", previewing: false, hasPreview: false });
  }

  async end() {
    this.halt();
    const finalized = this.device.close();
    try {
      if (this.started)
        this.update({ result: await this.command({ action: "close", id: this.id }) });
      if (!(await finalized))
        this.fail(new Error("Microphone stopped. GPT-Live final usage was not confirmed."));
    } catch (error) {
      this.fail(error);
    }
  }

  async prepareNotes() {
    if (this.state.phase !== "ended" || !this.started || this.disposed) return;
    this.notes ??= {
      action: "notes",
      id: this.id,
      requestId: this.newId(),
      context: this.state.transcript,
    };
    try {
      await this.command({ action: "close", id: this.id });
      this.update({ result: await this.command(this.notes), error: "" });
    } catch (error) {
      this.fail(error);
    }
  }

  dispose() {
    this.halt();
    this.disposed = true;
    void this.device.close();
    if (this.started) void this.command({ action: "close", id: this.id }).catch(() => {});
  }
}
