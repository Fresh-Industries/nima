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
  resumePlayback(): Promise<void>;
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
  playbackError: string;
  muted: boolean;
  volume: number;
  outputLevel: number;
  /** One person talking with Pucko: everything said is addressed to him. */
  solo: boolean;
  /** Pucko is taking the next thing said as addressed to him, without his name. */
  attentive: boolean;
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
  playbackError: "",
  muted: false,
  volume: 0.8,
  outputLevel: 0,
  solo: false,
  attentive: false,
  result: null,
  diagnostics: [],
};

// Words that put the name in the third person ("I asked Citrus") rather than calling him.
const ABOUT =
  "(?:ask|asked|tell|told|to|with|from|about|for|of|and|or|by|call|called|named|is|was|like|use|using|say|said|if|that|maybe|let|have|had)";

/**
 * The request in an utterance that calls Pucko by name: at the start ("Citrus, …"), set off
 * mid-sentence ("So, Citrus, …") or at the end ("What do you think, Citrus?"). Null when the
 * name is absent or only mentioned. The voice model still judges whether to answer.
 */
function addressedRequest(text: string, activationName: string) {
  const name = activationName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefix = new RegExp(
    `^[\\s.!?,;:…]*(?:(?:hey|hi|okay|ok)[,\\s]+)?${name}(?=$|[\\s,.!?])`,
    "iu",
  ).exec(text);
  if (prefix) return text.slice(prefix[0].length);
  const aside = new RegExp(`^(.*),\\s*${name}\\s*,(.*)$`, "isu").exec(text);
  if (aside) return `${aside[1]} ${aside[2]}`;
  const suffix = new RegExp(`^(.*?)[\\s,;:\\u2014-]+${name}[\\s.!?…]*$`, "isu").exec(text);
  if (suffix && !new RegExp(`(?:^|\\s)${ABOUT}[\\s,]*$`, "iu").test(suffix[1]!)) return suffix[1]!;
  return null;
}
// Said alone in a follow-up, these end the exchange instead of asking for more.
const CLOSING =
  /^[\s.!,]*(?:(?:ok|okay|great|cool|perfect|got it|alright)[\s,.!]*)?(?:thanks|thank you|thanks a lot|that's all|that is all|that's it|never ?mind|we're good|all good|no thanks)?[\s.!,]*$/iu;
const FOLLOW_UP_MS = 10000;
const TALK_MS = 15000;
export function isPuckoAddress(text: string, activationName: string) {
  return addressedRequest(text, activationName) !== null;
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
  private replyStarted = false;
  private receivedAudio = false;
  private playedAudio = false;
  private resuming = false;
  private waitingForAcceptance = false;
  private utteranceAddressed = false;
  private requestReady = false;
  private requestConsumed = false;
  private solo = false;
  // The floor is open while the next utterance counts as addressed without the name: for a
  // moment after a reply (a follow-up) or after a participant chose to talk to Pucko.
  private floorOpen = false;
  private floorTimer: ReturnType<typeof setTimeout> | undefined;
  private utteranceOpen = false;
  private utteranceNamed = false;
  private pendingDelegations = new Set<string>();
  private handledDelegations = new Set<string>();
  private delivered = new Set<string>();
  private sharedChat = new Set<string>();
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
  private activationName: string;
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
      attentive: this.floorOpen && !this.state.muted,
      character: this.state.muted
        ? "muted"
        : this.state.outputLevel > 0.01 &&
            this.addressed &&
            !this.waitingForAcceptance &&
            this.state.volume > 0
          ? "speaking"
          : this.addressed && !this.replyStarted
            ? this.inputActive || !this.requestReady
              ? "summoned"
              : "thinking"
            : this.floorOpen
              ? "summoned"
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
      this.activationName = result.activationName;
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
    if (this.state.muted) return;
    if (this.addressed) {
      if (this.requestReady && !this.waitingForAcceptance) this.device.setPlayback(true);
      return;
    }
    this.addressed = true;
    this.replyStarted = false;
    this.stage(
      this.requestReady
        ? "Activation detected; reply playback enabled"
        : "Activation detected; waiting for the request",
    );
    this.device.setPlayback(this.requestReady);
    clearTimeout(this.responseDeadline);
    // A response deadline releases an unanswered invitation; it never fabricates completion.
    this.responseDeadline = setTimeout(() => {
      if (!this.addressed || this.replyStarted) return;
      // Without the name, staying quiet is a fair answer to talk meant for someone else.
      const requested = this.requestReady && this.utteranceNamed;
      this.quiet();
      if (requested)
        this.fail(
          new Error("Pucko did not answer. Try addressing him again, or check voice diagnostics."),
        );
      this.character();
    }, 30000);
    this.character();
  }
  private quiet() {
    this.addressed = false;
    this.replyStarted = false;
    this.requestReady = false;
    clearTimeout(this.responseDeadline);
    this.device.setPlayback(false);
    this.update({ outputLevel: 0 });
  }
  private openFloor(ms: number) {
    clearTimeout(this.floorTimer);
    this.floorOpen = true;
    this.floorTimer = setTimeout(() => this.closeFloor(), ms);
  }
  private closeFloor() {
    clearTimeout(this.floorTimer);
    this.floorTimer = undefined;
    if (!this.floorOpen) return;
    this.floorOpen = false;
    this.character();
  }
  private awaitingRequest() {
    return this.addressed && !this.replyStarted && !this.requestConsumed;
  }
  receive(raw: unknown) {
    if (this.abort.signal.aborted || this.disposed || typeof raw !== "object" || raw === null)
      return;
    const event = raw as Record<string, unknown>;
    if (event.type === "session.started") {
      this.stage("Listening");
      this.update({ phase: "listening", character: "listening" });
      if (this.state.result) this.shareChat(this.state.result);
      if (this.solo) this.announceSolo();
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
      if (this.outputActive && !this.receivedAudio) {
        this.receivedAudio = true;
        this.stage("Incoming voice audio detected");
      }
      if (this.addressed && typeof event.level === "number" && event.level > 0.01) {
        this.replyStarted = true;
        clearTimeout(this.responseDeadline);
        if (!this.playedAudio) {
          this.playedAudio = true;
          this.stage("Voice audio reached the speaker player");
        }
      }
      this.update({ outputLevel: typeof event.level === "number" ? event.level : 0 });
      this.character();
      return;
    }
    if (event.type === "device.playback-blocked") {
      this.update({
        playbackError: "Speaker playback is blocked. Select Enable speaker to retry.",
      });
      this.stage("Speaker playback blocked");
      return;
    }
    if (event.type === "device.playback-ready") {
      this.update({ playbackError: "" });
      this.stage("Speaker player ready");
      return;
    }
    if (event.type === "device.input-start") {
      this.inputActive = true;
      // Speech inside the window holds it open until its words arrive.
      if (this.floorOpen) clearTimeout(this.floorTimer);
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
      if (!this.awaitingRequest()) {
        const answered = this.replyStarted || this.requestConsumed;
        this.quiet();
        // Acoustic boundaries can arrive between two transcript fragments of the wake name.
        if (answered) {
          this.utterance = "";
          this.utteranceAddressed = false;
          this.requestConsumed = false;
        }
        if (this.pendingDelegations.size) {
          this.pendingDelegations.clear();
          this.waitingForAcceptance = false;
        }
      }
      this.character();
      return;
    }
    if (event.type === "device.input-end") {
      this.inputActive = false;
      // A sound that produced no words must not leave the floor open indefinitely.
      if (this.floorOpen) this.openFloor(FOLLOW_UP_MS);
      if (this.addressed && this.requestReady && !this.state.muted && !this.waitingForAcceptance)
        this.device.setPlayback(true);
      this.flushDelegations();
      this.deliverAnswers();
      this.character();
      return;
    }
    if (event.type === "device.output-end") {
      this.outputActive = false;
      // GPT-Live pauses are not response-completion events; the next input revokes playback.
      this.update({ outputLevel: 0 });
      // After a reply the conversation continues: a follow-up needs no name.
      if (this.addressed && this.replyStarted && !this.state.muted) this.openFloor(FOLLOW_UP_MS);
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
      if (
        this.addressed &&
        this.utteranceAddressed &&
        this.requestReady &&
        !this.requestConsumed &&
        !this.waitingForAcceptance
      ) {
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
    if (!input && (!this.addressed || !this.requestReady || this.waitingForAcceptance)) return;
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
      // A nameless request Pucko let pass is over once someone speaks again after a pause.
      const passed = this.requestReady && !this.utteranceNamed && !this.replyStarted;
      if (event.start_ms - this.lastInputEnd > 1000 && (!this.awaitingRequest() || passed)) {
        this.quiet();
        this.utterance = "";
        this.utteranceAddressed = false;
        this.requestConsumed = false;
      }
      this.lastInputEnd = event.end_ms;
      if (!this.utterance) {
        // An open floor covers exactly one utterance; only a reply opens it again.
        this.utteranceOpen = this.solo || this.floorOpen;
        this.closeFloor();
      }
      this.utterance = (this.utterance + event.delta).slice(-4000);
      this.update({ candidate: this.utterance });
      const named = addressedRequest(this.utterance, this.activationName);
      this.utteranceNamed = named !== null;
      const request =
        named ?? (this.utteranceOpen && !CLOSING.test(this.utterance) ? this.utterance : null);
      // Later words can show the name was only mentioned ("…Citrus said so").
      if (request === null && this.utteranceAddressed && !this.replyStarted) this.quiet();
      this.utteranceAddressed = request !== null;
      const ready = request !== null && /[\p{L}\p{N}]/u.test(request);
      if (!this.requestReady && ready) this.addressed = false;
      this.requestReady = ready;
      if (this.utteranceAddressed) this.invite();
      this.flushDelegations();
    }
  }
  private flushDelegations() {
    if (this.inputActive || !this.addressed || !this.utteranceAddressed || !this.utterance.trim())
      return;
    for (const delegationId of this.pendingDelegations) {
      this.pendingDelegations.delete(delegationId);
      this.handledDelegations.add(delegationId);
      this.requestConsumed = true;
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
            "You have started on this request yourself. Say at most a few words, such as 'One sec' or 'Let me look'. Do not mention Bara, a handoff or anyone else, and do not claim it is finished.",
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
            "You could not start on this request. Stop the acknowledgement and remain quiet. Do not claim work started. The application is showing the failure for review.",
        });
    }
  }

  observe(result: MeetingExperimentResult) {
    if (result.id !== this.id || this.disposed) return;
    this.update({ result });
    this.shareChat(result);
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
  // Pucko's voice cannot read his chat; what is typed there reaches him as quiet context.
  private shareChat(result: MeetingExperimentResult) {
    if (this.state.phase !== "listening") return;
    const fresh = (result.chat ?? []).filter((entry) => !this.sharedChat.has(entry.id));
    if (!fresh.length) return;
    for (const entry of fresh) this.sharedChat.add(entry.id);
    this.device.send({
      type: "session.instructions.append",
      event_id: this.newId(),
      delegation_id: null,
      content: `Your chat, for context only. Do not speak about or reply to this notice.\n${fresh
        .map(
          (entry) =>
            `${entry.role === "pucko" ? "You wrote in chat" : "The participant typed in chat"}: ${entry.text}`,
        )
        .join("\n")}`,
    });
  }
  private deliverAnswers() {
    if (
      this.state.phase !== "listening" ||
      this.state.muted ||
      this.inputActive ||
      this.waitingForAcceptance ||
      this.outputActive ||
      !this.readyAnswers.length
    )
      return;
    // In a room, a finished task waits to be asked about. Alone with Pucko, he tells you.
    const asked =
      this.addressed && this.utteranceAddressed && this.requestReady && !this.replyStarted;
    if (!asked && !(this.solo && !this.awaitingRequest())) return;
    if (!asked) {
      this.replyStarted = false;
      this.requestReady = true;
      this.utteranceAddressed = true;
    }
    const results = this.readyAnswers.splice(0);
    const result = results[0];
    if (!result) return;
    const answer = results.map((entry) => entry.answer.slice(0, 1400 / results.length)).join("\n");
    this.addressed = false;
    this.invite();
    this.requestConsumed = true;
    this.device.send({
      type: "session.commentary.append",
      event_id: this.newId(),
      delegation_id: result.delegationId,
      content: `This is your own finished answer. Say it in the first person as your reply, briefly and without reading Markdown. Do not mention Bara, a handoff or a result arriving: ${answer.slice(0, 1400)}`,
    });
  }
  /** Solo mode: one participant, so every utterance is addressed to Pucko. */
  setSolo(solo: boolean) {
    if (this.solo === solo) return;
    this.solo = solo;
    this.update({ solo });
    if (this.state.phase !== "listening") return;
    this.announceSolo();
  }
  private announceSolo() {
    this.device.send({
      type: "session.instructions.append",
      event_id: this.newId(),
      delegation_id: null,
      content: this.solo
        ? `Solo mode is on: one participant is talking with you directly. Treat everything they say as addressed to you and answer without waiting for "${this.activationName}". Still stay silent for sounds that are not speech to you. Do not reply to this notice.`
        : `Solo mode is off: several participants are present again. Answer only when addressed by "${this.activationName}" or in a direct follow-up to your own reply. Do not reply to this notice.`,
    });
  }
  /** A participant chose to talk to Pucko (a tap or a key): their next utterance is his. */
  talk() {
    if (this.state.phase !== "listening" || this.state.muted || this.solo) return;
    this.openFloor(TALK_MS);
    this.device.send({
      type: "session.instructions.append",
      event_id: this.newId(),
      delegation_id: null,
      content: `A participant pressed the talk button. The next thing said is addressed to you even without "${this.activationName}"; answer it. Do not reply to this notice.`,
    });
    this.stage("Talk button pressed; listening for the request");
    this.character();
  }
  setVolume(volume: number) {
    const value = Math.max(0, Math.min(1, volume));
    this.device.setVolume(value);
    this.update({ volume: value });
    this.character();
  }
  async resumeSpeaker() {
    if (this.state.phase !== "listening") return;
    try {
      await this.device.resumePlayback();
    } catch {
      this.update({
        playbackError: "Speaker playback could not start. Check the sound output and retry.",
      });
    }
  }
  async toggleMute() {
    if (this.state.phase !== "listening" || this.resuming) return;
    if (!this.state.muted) {
      this.device.stopCapture();
      this.quiet();
      this.closeFloor();
      this.utteranceOpen = false;
      if (this.pendingDelegations.size) this.waitingForAcceptance = false;
      this.pendingDelegations.clear();
      this.inputActive = false;
      this.utterance = "";
      this.utteranceAddressed = false;
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
    clearTimeout(this.floorTimer);
    this.floorOpen = false;
    this.device.stopCapture();
    this.device.setPlayback(false);
    this.update({
      phase: "ended",
      character: "idle",
      outputLevel: 0,
      attentive: false,
      stage: "Meeting ended",
    });
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
