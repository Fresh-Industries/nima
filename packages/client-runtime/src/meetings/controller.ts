// @effect-diagnostics globalTimers:off - This browser voice controller runs outside an Effect runtime.
import type {
  BotId,
  MeetingExperimentCommand,
  MeetingExperimentResult,
  ProjectId,
} from "@t3tools/contracts";

export interface MeetingDevice {
  offer(
    onEvent: (event: unknown) => void,
    onFailure: (message: string) => void,
    signal: AbortSignal,
    onStage: (stage: string) => void,
  ): Promise<string>;
  accept(sdp: string): Promise<void>;
  stopCapture(): void;
  unmute(signal: AbortSignal): Promise<void>;
  setPlayback(enabled: boolean): void;
  setVolume(volume: number): void;
  send(event: Record<string, unknown>): void;
  close(): Promise<boolean>;
}
export type PuckoCharacterState =
  | "idle"
  | "listening"
  | "summoned"
  | "thinking"
  | "speaking"
  | "working"
  | "muted"
  | "error";
export type MeetingState = {
  phase: "idle" | "connecting" | "listening" | "ended";
  stage: string;
  character: PuckoCharacterState;
  transcript: string;
  candidate: string;
  error: string;
  muted: boolean;
  volume: number;
  outputLevel: number;
  result: MeetingExperimentResult | null;
  diagnostics: string[];
};
export const initialMeetingState: MeetingState = {
  phase: "idle",
  stage: "Ready",
  character: "idle",
  transcript: "",
  candidate: "",
  error: "",
  muted: false,
  volume: 0.8,
  outputLevel: 0,
  result: null,
  diagnostics: [],
};

export function isPuckoAddress(text: string, activationName: string) {
  const escaped = activationName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*(?:(?:hey|hi|okay|ok)[,\\s]+)?${escaped}(?=$|[\\s,.!?])`, "iu").test(
    text,
  );
}

export class MeetingController {
  private state: MeetingState = { ...initialMeetingState };
  private abort = new AbortController();
  private disposed = false;
  private started = false;
  private events = new Set<string>();
  private addressed = false;
  private inputActive = false;
  private outputActive = false;
  private resuming = false;
  private waitingForAcceptance = false;
  private utteranceDelegated = false;
  private pendingDelegations = new Set<string>();
  private handledDelegations = new Set<string>();
  private delivered = new Set<string>();
  private readyAnswers: { id: string; delegationId: string | null; answer: string }[] = [];
  private utterance = "";
  private lastInputEnd = -1;
  private lastSpeaker = "";
  private revision = 0;
  private checkpoint: ReturnType<typeof setTimeout> | undefined;
  private responseDeadline: ReturnType<typeof setTimeout> | undefined;
  private writes: Promise<unknown> = Promise.resolve();
  readonly id: string;
  private readonly device: MeetingDevice;
  private readonly command: (input: MeetingExperimentCommand) => Promise<MeetingExperimentResult>;
  private readonly changed: (state: MeetingState) => void;
  private readonly newId: () => string;
  private readonly activationName: string;
  constructor(
    id: string,
    device: MeetingDevice,
    command: (input: MeetingExperimentCommand) => Promise<MeetingExperimentResult>,
    changed: (state: MeetingState) => void,
    newId: () => string,
    activationName = "Citrus",
  ) {
    this.id = id;
    this.device = device;
    this.command = command;
    this.changed = changed;
    this.newId = newId;
    this.activationName = activationName;
  }
  private update(patch: Partial<MeetingState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.changed(this.state);
  }
  private stage(stage: string) {
    this.update({ stage, diagnostics: [...this.state.diagnostics.slice(-19), stage] });
  }
  private fail(error: unknown) {
    this.update({
      error: error instanceof Error ? error.message : "Pucko could not complete this operation.",
      ...(this.state.phase === "ended" ? { character: "error" as const } : {}),
    });
  }
  private character() {
    if (this.state.phase !== "listening") return;
    const working =
      this.state.result?.requests.some((entry) =>
        ["accepted", "preparing", "running", "waiting"].includes(entry.status),
      ) ||
      this.state.result?.tasks.some((task) =>
        ["pending", "running", "waiting"].includes(task.status),
      );
    this.update({
      character: this.state.muted
        ? "muted"
        : this.state.outputLevel > 0.01 &&
            this.addressed &&
            !this.waitingForAcceptance &&
            this.state.volume > 0
          ? "speaking"
          : this.addressed
            ? this.inputActive
              ? "summoned"
              : "thinking"
            : working
              ? "working"
              : "listening",
    });
  }
  async start(
    consent: boolean,
    scope: { projectId: ProjectId | null; coordinatorBotId: BotId | null } = {
      projectId: null,
      coordinatorBotId: null,
    },
  ) {
    if (!consent || this.state.phase !== "idle" || this.disposed) return;
    this.update({ phase: "connecting", error: "" });
    try {
      const sdp = await this.device.offer(
        (event) => this.receive(event),
        (message) => {
          void this.end();
          this.fail(new Error(message));
        },
        this.abort.signal,
        (stage) => this.stage(stage),
      );
      if (this.abort.signal.aborted) return;
      this.stage("Connecting to GPT-Live");
      const result = await this.command({
        action: "start",
        id: this.id,
        consent: true,
        sdp,
        ...scope,
      });
      this.started = true;
      if (this.abort.signal.aborted) {
        await this.command({ action: "close", id: this.id });
        return;
      }
      if (!result.sdp) throw new Error("GPT-Live returned no connection answer.");
      this.update({ result });
      this.stage("Waiting for the voice session");
      await this.device.accept(result.sdp);
    } catch (error) {
      const ending = this.end();
      this.fail(error);
      await ending;
    }
  }
  private invite() {
    if (this.addressed || this.state.muted) return;
    this.addressed = true;
    this.device.setPlayback(true);
    clearTimeout(this.responseDeadline);
    // A response deadline releases an unanswered invitation; it never fabricates completion.
    this.responseDeadline = setTimeout(() => {
      if (!this.addressed || this.outputActive) return;
      this.addressed = false;
      this.device.setPlayback(false);
      this.fail(
        new Error("Pucko did not answer. Try addressing him again, or check voice diagnostics."),
      );
      this.character();
    }, 30000);
    this.character();
  }
  receive(raw: unknown) {
    if (this.abort.signal.aborted || this.disposed || typeof raw !== "object" || raw === null)
      return;
    const event = raw as Record<string, unknown>;
    if (event.type === "session.started") {
      this.stage("Listening");
      this.update({ phase: "listening", character: "listening" });
      return;
    }
    if (event.type === "error" || event.type === "session.closed") {
      void this.end();
      this.fail(
        new Error(
          event.type === "error"
            ? "GPT-Live reported a voice error. Capture stopped; retry the meeting."
            : "The voice session closed. Capture stopped.",
        ),
      );
      return;
    }
    if (event.type === "device.audio") {
      this.outputActive = event.outputActive === true;
      this.update({ outputLevel: typeof event.level === "number" ? event.level : 0 });
      this.character();
      return;
    }
    if (event.type === "device.input-start") {
      this.inputActive = true;
      if (this.outputActive && this.addressed) {
        this.device.setPlayback(false);
        this.device.send({
          type: "session.instructions.append",
          event_id: this.newId(),
          delegation_id: null,
          content:
            "A participant interrupted. Stop the current reply and listen to the complete correction before responding.",
        });
      }
      this.character();
      return;
    }
    if (event.type === "device.input-end") {
      this.inputActive = false;
      if (this.addressed && !this.state.muted && !this.waitingForAcceptance)
        this.device.setPlayback(true);
      this.flushDelegations();
      this.deliverAnswers();
      this.character();
      return;
    }
    if (event.type === "device.output-end") {
      this.outputActive = false;
      this.addressed = false;
      clearTimeout(this.responseDeadline);
      this.device.setPlayback(false);
      this.update({ outputLevel: 0 });
      this.deliverAnswers();
      this.character();
      return;
    }
    if (event.type === "session.delegation.created") {
      const delegation = event.delegation;
      if (
        typeof delegation !== "object" ||
        delegation === null ||
        !("id" in delegation) ||
        typeof delegation.id !== "string"
      )
        return;
      const id = delegation.id;
      if (this.handledDelegations.has(id) || this.pendingDelegations.has(id)) return;
      this.device.send({
        type: "session.thinking.append",
        event_id: this.newId(),
        delegation_id: id,
        content: "",
      });
      if (this.addressed && !this.utteranceDelegated && !this.waitingForAcceptance) {
        this.waitingForAcceptance = true;
        this.device.setPlayback(false);
        this.update({ outputLevel: 0 });
        this.pendingDelegations.add(id);
        this.flushDelegations();
      }
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
      typeof event.end_ms !== "number" ||
      this.events.has(event.event_id)
    )
      return;
    this.events.add(event.event_id);
    if (this.events.size > 20000) this.events.delete(this.events.values().next().value!);
    const input = event.type === "session.input_transcript.delta";
    if (!input && (!this.addressed || this.waitingForAcceptance)) return;
    const speaker = input ? "Participants" : "Pucko";
    const prefix = this.lastSpeaker === speaker ? "" : `\n${speaker}: `;
    this.lastSpeaker = speaker;
    let transcript = this.state.transcript + prefix + event.delta;
    if (transcript.length > 240000)
      transcript =
        "[Earlier meeting text exceeded retained context.]\n" + transcript.slice(-220000);
    this.update({ transcript });
    this.scheduleCheckpoint();
    if (input && !this.state.muted) {
      if (event.start_ms - this.lastInputEnd > 1000) {
        this.utterance = "";
        this.utteranceDelegated = false;
      }
      this.lastInputEnd = event.end_ms;
      this.utterance = (this.utterance + event.delta).slice(-4000);
      this.update({ candidate: this.utterance });
      if (isPuckoAddress(this.utterance, this.activationName)) this.invite();
      this.flushDelegations();
    }
  }
  private flushDelegations() {
    if (this.inputActive || !this.addressed || !this.utterance.trim()) return;
    for (const delegationId of this.pendingDelegations) {
      this.pendingDelegations.delete(delegationId);
      this.handledDelegations.add(delegationId);
      this.utteranceDelegated = true;
      void this.submit(this.utterance, delegationId);
    }
  }
  private scheduleCheckpoint() {
    if (this.checkpoint !== undefined || !this.started) return;
    // Batch real transcript changes; audio frames never travel through Bara's RPC channel.
    this.checkpoint = setTimeout(() => {
      this.checkpoint = undefined;
      void this.checkpointContext();
    }, 2000);
  }
  private checkpointContext() {
    const context = this.state.transcript,
      revision = ++this.revision;
    this.writes = this.writes
      .catch(() => {})
      .then(() => this.command({ action: "sync", id: this.id, context, revision }));
    return this.writes.catch(() => {
      this.fail(
        new Error(
          "Meeting text could not be saved. Keep this window open and retry before closing.",
        ),
      );
    });
  }
  async submit(request: string, delegationId?: string) {
    if (this.state.phase !== "listening" || !request.trim()) return;
    try {
      this.observe(
        await this.command({
          action: "invite",
          id: this.id,
          requestId: delegationId ? `voice-${this.newId()}` : this.newId(),
          request: request.slice(0, 4000),
          context: this.state.transcript,
          ...(delegationId ? { delegationId } : {}),
        }),
      );
      if (delegationId) {
        this.waitingForAcceptance = false;
        this.readyAnswers.push({
          id: `accepted:${delegationId}`,
          delegationId,
          answer:
            "Bara accepted this request. Briefly say you have sent it to Bara and will share the result. Do not claim the provider has started or work is complete. Any required approvals still apply.",
        });
        this.deliverAnswers();
      }
    } catch (error) {
      this.waitingForAcceptance = false;
      this.addressed = false;
      this.device.setPlayback(false);
      this.fail(error);
      this.character();
      if (delegationId)
        this.device.send({
          type: "session.instructions.append",
          event_id: this.newId(),
          delegation_id: null,
          content:
            "Bara could not confirm accepting this request. Stop the acknowledgement and remain quiet. Do not claim work started. The application is showing the failure for review.",
        });
    }
  }

  observe(result: MeetingExperimentResult) {
    if (result.id !== this.id || this.disposed) return;
    this.update({ result });
    for (const request of result.requests) {
      if (
        request.status !== "completed" ||
        !request.answer ||
        this.delivered.has(request.requestId)
      )
        continue;
      this.delivered.add(request.requestId);
      this.readyAnswers.push({
        id: request.requestId,
        delegationId: request.delegationId,
        answer: request.answer,
      });
    }
    for (const task of result.tasks) {
      const key = `task:${task.id}`;
      if (task.status !== "completed" || !task.answer || this.delivered.has(key)) continue;
      this.delivered.add(key);
      this.readyAnswers.push({ id: key, delegationId: null, answer: task.answer });
    }
    this.deliverAnswers();
    this.character();
  }
  private deliverAnswers() {
    if (
      this.state.phase !== "listening" ||
      this.state.muted ||
      this.inputActive ||
      this.waitingForAcceptance ||
      this.outputActive
    )
      return;
    const results = this.readyAnswers.splice(0);
    const result = results[0];
    if (!result) return;
    const answer = results.map((entry) => entry.answer.slice(0, 1400 / results.length)).join("\n");
    this.addressed = false;
    this.invite();
    this.device.send({
      type: "session.commentary.append",
      event_id: this.newId(),
      delegation_id: result.delegationId,
      content: `Confirmed Bara result. Briefly report the useful outcome without reading Markdown: ${answer.slice(0, 1400)}`,
    });
  }
  setVolume(volume: number) {
    const value = Math.max(0, Math.min(1, volume));
    this.device.setVolume(value);
    this.update({ volume: value });
    this.character();
  }
  async toggleMute() {
    if (this.state.phase !== "listening" || this.resuming) return;
    if (!this.state.muted) {
      this.device.stopCapture();
      this.device.setPlayback(false);
      this.addressed = false;
      this.pendingDelegations.clear();
      this.inputActive = false;
      this.utterance = "";
      this.update({ muted: true, character: "muted", outputLevel: 0 });
    } else {
      this.resuming = true;
      try {
        await this.device.unmute(this.abort.signal);
        if (!this.abort.signal.aborted) {
          this.update({ muted: false, error: "" });
          this.deliverAnswers();
          this.character();
        }
      } catch (error) {
        this.fail(error);
      } finally {
        this.resuming = false;
      }
    }
  }
  private halt() {
    this.abort.abort();
    clearTimeout(this.checkpoint);
    clearTimeout(this.responseDeadline);
    this.device.stopCapture();
    this.device.setPlayback(false);
    this.update({ phase: "ended", character: "idle", outputLevel: 0, stage: "Meeting ended" });
  }
  async end() {
    if (this.state.phase === "ended" || this.disposed) return;
    this.halt();
    const closed = this.device.close();
    try {
      await this.writes.catch(() => {});
      if (this.started) {
        this.observe(
          await this.command({ action: "close", id: this.id, context: this.state.transcript }),
        );
        if (this.state.transcript.trim())
          this.observe(
            await this.command({
              action: "notes",
              id: this.id,
              requestId: `notes-${this.id}`,
              context: this.state.transcript,
            }),
          );
      }
      if (!(await closed) && !this.state.error)
        this.fail(
          new Error("Capture stopped. The voice service did not confirm final session usage."),
        );
    } catch (error) {
      this.fail(error);
    }
  }
  async prepareNotes() {
    if (!this.started || this.state.phase !== "ended") return;
    try {
      this.observe(
        await this.command({
          action: "notes",
          id: this.id,
          requestId: `notes-${this.newId()}`,
          context: this.state.transcript,
        }),
      );
    } catch (error) {
      this.fail(error);
    }
  }
  dispose() {
    this.halt();
    this.disposed = true;
    void this.device.close();
    if (this.started)
      void this.command({ action: "close", id: this.id, context: this.state.transcript }).catch(
        () => {},
      );
  }
}
