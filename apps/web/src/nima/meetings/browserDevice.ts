import type { MeetingDevice } from "@t3tools/client-runtime/meetings";

export class BrowserMeetingDevice implements MeetingDevice {
  private peer: RTCPeerConnection | null = null;
  private microphone: MediaStream | null = null;
  private output: MediaStream | null = null;
  private sender: RTCRtpSender | null = null;
  private events: RTCDataChannel | null = null;
  private context: AudioContext | null = null;
  private player: HTMLAudioElement | null = null;
  private inputSource: MediaStreamAudioSourceNode | null = null;
  private inputMeter: AnalyserNode | null = null;
  private outputMeter: AnalyserNode | null = null;
  private outputSource: MediaStreamAudioSourceNode | null = null;
  private sampler: ReturnType<typeof setInterval> | undefined;
  private startupTimeout: ReturnType<typeof setTimeout> | undefined;
  private volume = 0.8;
  private playback = false;
  private closing: Promise<boolean> | null = null;
  private closingRequested = false;
  private finalized = false;
  private resolveClose: ((confirmed: boolean) => void) | null = null;
  private onEvent: (event: unknown) => void = () => {};
  private onFailure: (message: string) => void = () => {};

  async offer(
    onEvent: (event: unknown) => void,
    onFailure: (message: string) => void,
    signal: AbortSignal,
    onStage: (stage: string) => void,
  ) {
    try {
      return await this.prepareOffer(onEvent, onFailure, signal, onStage);
    } catch (error) {
      await this.close();
      throw error;
    }
  }
  private async prepareOffer(
    onEvent: (event: unknown) => void,
    onFailure: (message: string) => void,
    signal: AbortSignal,
    onStage: (stage: string) => void,
  ) {
    this.onEvent = onEvent;
    this.onFailure = onFailure;
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error(
        "Microphone access requires the desktop app, localhost, or an HTTPS connection.",
      );
    const peer = new RTCPeerConnection();
    this.peer = peer;
    this.player = new Audio();
    this.player.autoplay = true;
    this.player.muted = true;
    this.player.volume = this.volume;
    this.context = new AudioContext();
    await this.context.resume();
    onStage("Waiting for microphone permission");
    const microphone = await this.capture(signal);
    if (signal.aborted) throw new Error("Meeting canceled.");
    onStage("Microphone ready");
    for (const track of microphone.getAudioTracks()) this.sender = peer.addTrack(track, microphone);
    peer.addEventListener("track", ({ track }) => {
      if (track.kind !== "audio" || this.closingRequested || !this.context) return;
      this.output = new MediaStream([track]);
      this.outputMeter = this.context.createAnalyser();
      this.outputMeter.fftSize = 1024;
      this.outputSource = this.context.createMediaStreamSource(this.output);
      this.outputSource.connect(this.outputMeter);
      if (this.player) this.player.srcObject = this.output;
      this.setPlayback(this.playback);
      this.startPlayer();
      onStage("Speaker audio connected");
    });
    peer.addEventListener("connectionstatechange", () => {
      if (this.closingRequested) return;
      if (peer.connectionState === "connected") onStage("Voice transport connected");
      if (peer.connectionState === "failed" || peer.connectionState === "disconnected")
        onFailure("Voice connection lost. Local capture stopped; authorized tasks continue.");
    });
    const events = peer.createDataChannel("oai-events");
    this.events = events;
    events.addEventListener("open", () => onStage("Voice event channel connected"));
    events.addEventListener("error", () => {
      if (!this.closingRequested) onFailure("The voice event channel failed. Retry the meeting.");
    });
    events.addEventListener("close", () => {
      this.resolveClose?.(this.finalized);
      if (!this.closingRequested && !this.finalized)
        onFailure("The voice event channel closed. Capture stopped.");
    });
    events.addEventListener("message", ({ data }) => {
      if (typeof data !== "string" || data.length > 64000) return;
      let event: unknown;
      try {
        event = JSON.parse(data);
      } catch {
        onFailure("The voice service sent an invalid event.");
        return;
      }
      if (typeof event !== "object" || event === null || !("type" in event)) return;
      if (event.type === "session.started") clearTimeout(this.startupTimeout);
      if (event.type === "session.closed") {
        this.finalized = true;
        this.resolveClose?.(true);
      }
      try {
        onEvent(event);
      } catch {
        onFailure("Could not process a voice update. Capture stopped.");
      }
    });
    onStage("Preparing voice connection");
    await peer.setLocalDescription(await peer.createOffer());
    if (peer.iceGatheringState !== "complete")
      await new Promise<void>((resolve, reject) => {
        const finish = (error?: Error) => {
          clearTimeout(timeout);
          peer.removeEventListener("icegatheringstatechange", changed);
          signal.removeEventListener("abort", aborted);
          if (error) reject(error);
          else resolve();
        };
        const changed = () => {
          if (peer.iceGatheringState === "complete") finish();
        };
        const aborted = () => finish(new Error("Meeting canceled."));
        const timeout = setTimeout(
          () => finish(new Error("Voice connection timed out while gathering network candidates.")),
          10000,
        );
        peer.addEventListener("icegatheringstatechange", changed);
        signal.addEventListener("abort", aborted, { once: true });
        if (signal.aborted) aborted();
        else changed();
      });
    if (!peer.localDescription?.sdp)
      throw new Error("The browser could not prepare a voice connection offer.");
    this.sampleAudio();
    return peer.localDescription.sdp;
  }
  private async capture(signal: AbortSignal) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    if (signal.aborted || this.closingRequested) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("Meeting canceled before microphone preparation finished.");
    }
    this.microphone = stream;
    signal.addEventListener("abort", () => this.stopCapture(), { once: true });
    for (const track of stream.getTracks())
      track.addEventListener("ended", () => {
        if (this.microphone === stream) this.onFailure("Microphone disconnected. Capture stopped.");
      });
    if (this.context) {
      this.inputSource = this.context.createMediaStreamSource(stream);
      this.inputMeter = this.context.createAnalyser();
      this.inputMeter.fftSize = 1024;
      this.inputSource.connect(this.inputMeter);
    }
    return stream;
  }
  private sampleAudio() {
    const input = new Float32Array(1024),
      output = new Float32Array(1024);
    let inputActive = false,
      outputActive = false,
      inputLoud = 0,
      inputQuiet = 0,
      outputQuiet = 0,
      lastLevel = 0;
    const rms = (meter: AnalyserNode | null, buffer: Float32Array<ArrayBuffer>) => {
      if (!meter) return 0;
      meter.getFloatTimeDomainData(buffer);
      return Math.sqrt(buffer.reduce((sum, value) => sum + value * value, 0) / buffer.length);
    };
    // Acoustic thresholds segment real audio; they do not simulate character or task states.
    this.sampler = setInterval(() => {
      const incoming = rms(this.inputMeter, input),
        outgoing = rms(this.outputMeter, output);
      // Speech is sustained; a click, a cough or a chair is not. While Pucko speaks, his own
      // voice also reaches the microphone, so interrupting him takes clearer, longer speech.
      const loud = incoming > (outputActive ? 0.04 : 0.018);
      inputLoud = loud ? inputLoud + 1 : 0;
      if (inputLoud >= (outputActive ? 6 : 2) && !inputActive) {
        inputActive = true;
        this.onEvent({ type: "device.input-start" });
      }
      inputQuiet = incoming > 0.018 ? 0 : inputQuiet + 1;
      if (inputActive && inputQuiet >= 12) {
        inputActive = false;
        this.onEvent({ type: "device.input-end" });
      }
      const wasOutput = outputActive;
      if (outgoing > 0.006) outputActive = true;
      outputQuiet = outgoing > 0.006 ? 0 : outputQuiet + 1;
      if (outputActive && outputQuiet >= 12) {
        outputActive = false;
        this.onEvent({ type: "device.output-end" });
      }
      const level =
        this.playback && this.player && !this.player.paused && !this.player.muted
          ? Math.min(1, outgoing * this.volume * 8)
          : 0;
      if (
        Math.abs(level - lastLevel) > 0.035 ||
        wasOutput !== outputActive ||
        (level === 0 && lastLevel !== 0)
      ) {
        lastLevel = level;
        this.onEvent({ type: "device.audio", level, outputActive });
      }
    }, 50);
  }
  async accept(sdp: string) {
    if (!this.peer || !this.microphone || this.closingRequested)
      throw new Error("Microphone capture has stopped.");
    this.startupTimeout = setTimeout(
      () =>
        this.onFailure(
          "GPT-Live did not confirm startup. Check the connection diagnostics and project access.",
        ),
      15000,
    );
    await this.peer.setRemoteDescription({ type: "answer", sdp });
  }
  stopCapture() {
    const stream = this.microphone;
    this.microphone = null;
    stream?.getTracks().forEach((track) => track.stop());
    this.inputSource?.disconnect();
    this.inputSource = null;
    this.inputMeter = null;
  }
  async unmute(signal: AbortSignal) {
    const stream = await this.capture(signal);
    const track = stream.getAudioTracks()[0];
    if (!track || !this.sender) {
      this.stopCapture();
      throw new Error("The microphone could not reconnect.");
    }
    try {
      await this.sender.replaceTrack(track);
    } catch (error) {
      this.stopCapture();
      throw error;
    }
  }
  setPlayback(enabled: boolean) {
    const opening = enabled && !this.playback;
    this.playback = enabled;
    if (this.player) this.player.muted = !enabled;
    if (opening && this.player?.srcObject) this.startPlayer();
  }
  setVolume(volume: number) {
    this.volume = volume;
    if (this.player) this.player.volume = volume;
  }
  async resumePlayback() {
    if (!this.player?.srcObject || this.closingRequested)
      throw new Error("The speaker stream is not connected.");
    await this.player.play();
    if (!this.closingRequested) {
      if (this.context?.state === "suspended") void this.context.resume().catch(() => {});
      this.onEvent({ type: "device.playback-ready" });
    }
  }
  private startPlayer() {
    void this.resumePlayback().catch(() => {
      if (!this.closingRequested) this.onEvent({ type: "device.playback-blocked" });
    });
  }
  send(event: Record<string, unknown>) {
    if (this.events?.readyState === "open") this.events.send(JSON.stringify(event));
  }
  close() {
    this.stopCapture();
    clearTimeout(this.startupTimeout);
    clearInterval(this.sampler);
    if (this.closing) return this.closing;
    this.closingRequested = true;
    this.player?.pause();
    if (this.player) this.player.srcObject = null;
    this.closing = new Promise<boolean>((resolve) => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let settled = false;
      const finish = (confirmed: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.events?.close();
        this.peer?.close();
        this.output?.getTracks().forEach((track) => track.stop());
        this.output = null;
        this.outputSource?.disconnect();
        this.outputMeter?.disconnect();
        if (this.context && this.context.state !== "closed")
          void this.context.close().catch(() => {});
        resolve(confirmed);
      };
      this.resolveClose = finish;
      if (this.finalized || this.events?.readyState !== "open") {
        finish(this.finalized);
        return;
      }
      timeout = setTimeout(() => finish(false), 5000);
      this.send({ type: "session.close" });
    });
    return this.closing;
  }
}
