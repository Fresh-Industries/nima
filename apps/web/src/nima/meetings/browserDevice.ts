import type { MeetingClip, MeetingDevice } from "@t3tools/client-runtime/meetings";
import { randomUUID } from "../../lib/utils";

export class BrowserMeetingDevice implements MeetingDevice {
  private peer: RTCPeerConnection | null = null;
  private microphone: MediaStream | null = null;
  private events: RTCDataChannel | null = null;
  private output: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private clips = new Set<MeetingClip>();
  private finalized = false;
  private closing: Promise<boolean> | null = null;
  private resolveClose: ((confirmed: boolean) => void) | null = null;
  private captureStopped = false;
  private closingRequested = false;
  private startupTimeout: ReturnType<typeof setTimeout> | undefined;
  private onFailure: ((message: string) => void) | null = null;

  async offer(
    onEvent: (event: unknown) => void,
    onFailure: (message: string) => void,
    signal: AbortSignal,
  ) {
    this.onFailure = onFailure;
    const peer = new RTCPeerConnection();
    this.peer = peer;
    const microphone = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    if (signal.aborted) {
      microphone.getTracks().forEach((track) => track.stop());
      peer.close();
      throw new Error("Meeting canceled before microphone preparation finished.");
    }
    this.microphone = microphone;
    signal.addEventListener("abort", () => this.stopCapture(), { once: true });
    microphone.getTracks().forEach((track) => {
      peer.addTrack(track, microphone);
      track.addEventListener("ended", () => onFailure("Microphone disconnected. Capture stopped."));
    });
    // No audio element or connected audio destination: unsolicited model output is inaudible.
    peer.addEventListener("track", ({ track }) => {
      this.output = new MediaStream([track]);
    });
    peer.addEventListener("connectionstatechange", () => {
      if (peer.connectionState === "failed" || peer.connectionState === "disconnected")
        onFailure("Voice connection lost. Capture stopped; authorized Work continues.");
    });
    const events = peer.createDataChannel("oai-events");
    this.events = events;
    events.addEventListener("message", ({ data }) => {
      if (typeof data !== "string" || data.length > 64000) return;
      let event: unknown;
      try {
        event = JSON.parse(data);
      } catch {
        onFailure("Invalid voice event. Capture stopped.");
        return;
      }
      if (
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        event.type === "session.closed"
      ) {
        this.finalized = true;
        this.resolveClose?.(true);
      }
      onEvent(event);
      if (
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        event.type === "session.started"
      )
        clearTimeout(this.startupTimeout);
    });
    events.addEventListener("close", () => {
      if (!this.closingRequested && !this.finalized)
        onFailure("Voice event channel closed. Capture stopped.");
      this.resolveClose?.(this.finalized);
    });
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
          () => finish(new Error("Voice connection timed out during ICE setup.")),
          10000,
        );
        peer.addEventListener("icegatheringstatechange", changed);
        signal.addEventListener("abort", aborted, { once: true });
        if (signal.aborted) aborted();
        else changed();
      });
    if (!peer.localDescription?.sdp) throw new Error("No local SDP offer.");
    return peer.localDescription.sdp;
  }

  async accept(sdp: string) {
    if (!this.peer || !this.microphone) throw new Error("Microphone capture has stopped.");
    this.startupTimeout = setTimeout(() => {
      this.stopCapture();
      this.onFailure?.("GPT-Live did not confirm startup. Capture stopped.");
      void this.close();
    }, 15000);
    await this.peer.setRemoteDescription({ type: "answer", sdp });
  }

  stopCapture() {
    this.captureStopped = true;
    clearTimeout(this.startupTimeout);
    this.microphone?.getTracks().forEach((track) => track.stop());
    this.microphone = null;
    this.clips.forEach((clip) => clip.dispose());
    this.clips.clear();
    if (this.recorder?.state === "recording") this.recorder.stop();
  }

  close() {
    this.stopCapture();
    if (this.closing) return this.closing;
    this.closingRequested = true;
    this.closing = new Promise<boolean>((resolve) => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let settled = false;
      const cleanup = (confirmed: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.peer?.close();
        this.output?.getTracks().forEach((track) => track.stop());
        this.output = null;
        this.recorder = null;
        this.preview = null;
        resolve(confirmed);
      };
      this.resolveClose = cleanup;
      if (this.finalized) {
        cleanup(true);
        return;
      }
      if (this.events?.readyState !== "open") {
        cleanup(false);
        return;
      }
      timeout = setTimeout(() => cleanup(false), 5000);
      this.events.send(JSON.stringify({ type: "session.close" }));
    });
    return this.closing;
  }

  beginPreview(text: string) {
    if (this.captureStopped || !this.output || this.events?.readyState !== "open")
      throw new Error("Voice output is not ready.");
    if (typeof MediaRecorder === "undefined")
      throw new Error("Audio previews are unavailable on this client.");
    const recorder = new MediaRecorder(this.output);
    this.recorder = recorder;
    const parts: Blob[] = [];
    let bytes = 0;
    recorder.addEventListener("dataavailable", ({ data }) => {
      bytes += data.size;
      if (bytes > 8 * 1024 * 1024) {
        if (recorder.state === "recording") recorder.stop();
      } else if (data.size) parts.push(data);
    });
    this.preview = new Promise<MeetingClip>((resolve, reject) => {
      recorder.addEventListener("error", () =>
        reject(new Error("Could not capture voice preview.")),
      );
      recorder.addEventListener(
        "stop",
        () => {
          clearTimeout(limit);
          const blob = new Blob(parts, { type: recorder.mimeType });
          if (!blob.size) {
            reject(new Error("GPT-Live returned no audio preview."));
            return;
          }
          const url = URL.createObjectURL(blob);
          const player = new Audio(url);
          let disposed = false;
          const clip: MeetingClip = {
            play: () => (disposed ? Promise.reject(new Error("Preview expired.")) : player.play()),
            stop: () => {
              player.pause();
              player.currentTime = 0;
            },
            dispose: () => {
              if (disposed) return;
              disposed = true;
              player.pause();
              player.removeAttribute("src");
              URL.revokeObjectURL(url);
              this.clips.delete(clip);
            },
          };
          this.clips.add(clip);
          if (this.captureStopped) clip.dispose();
          resolve(clip);
        },
        { once: true },
      );
    });
    const limit = setTimeout(() => {
      if (recorder.state === "recording") recorder.stop();
    }, 30000);
    recorder.start(1000);
    this.events.send(
      JSON.stringify({
        type: "session.commentary.append",
        event_id: randomUUID(),
        delegation_id: null,
        content: `Prepare a short spoken preview of this verified Bara answer. Do not add facts or claim other work. ${text}`,
      }),
    );
    // The controller may discard a preview after capture stops, without awaiting this promise.
    void this.preview.catch(() => {});
  }

  private preview: Promise<MeetingClip> | null = null;

  finishPreview() {
    const preview = this.preview;
    if (!preview) return Promise.reject(new Error("No active preview."));
    if (this.recorder?.state === "recording") this.recorder.stop();
    this.preview = null;
    return preview;
  }
}
