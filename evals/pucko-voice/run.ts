// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalTimers:off - An opt-in native WebRTC fixture drives the real voice API without an Effect runtime.
import * as NodeModule from "node:module";
import * as NodeUtil from "node:util";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { puckoInstructions } from "../../apps/server/src/meetings/puckoInstructions.ts";
import {
  MeetingController,
  type MeetingState,
} from "../../packages/client-runtime/src/meetings/controller.ts";
import type { MeetingExperimentResult } from "@t3tools/contracts";
import { cases } from "./cases.ts";

type Track = { stop(): void };
type Audio = {
  samples: Int16Array;
  sampleRate: number;
  bitsPerSample?: number;
  channelCount?: number;
  numberOfFrames?: number;
};
type Channel = {
  readyState: string;
  onmessage: ((event: { data: string }) => void) | null;
  send(data: string): void;
  close(): void;
};
type Peer = {
  iceGatheringState: string;
  localDescription: { sdp: string };
  onicegatheringstatechange: (() => void) | null;
  ontrack: ((event: { track: Track }) => void) | null;
  addTrack(track: Track): void;
  createDataChannel(name: string): Channel;
  createOffer(): Promise<unknown>;
  setLocalDescription(offer: unknown): Promise<void>;
  setRemoteDescription(answer: { type: string; sdp: string }): Promise<void>;
  close(): void;
};
type Sink = { ondata: ((data: Audio) => void) | null; stop(): void };
type NativeWebRtc = {
  RTCPeerConnection: new (configuration: { iceServers: never[] }) => Peer;
  nonstandard: {
    RTCAudioSource: new () => { createTrack(): Track; onData(data: Audio): void };
    RTCAudioSink: new (track: Track) => Sink;
  };
};
const { values } = NodeUtil.parseArgs({
  options: {
    out: { type: "string" },
    model: { type: "string", default: "gpt-live-1" },
    case: { type: "string" },
    samples: { type: "string", default: "3" },
    baseline: { type: "string" },
    "webrtc-module": { type: "string" },
    controller: { type: "boolean", default: false },
  },
});
if (!values.out || !values["webrtc-module"])
  throw new Error("Use --out <dir> --webrtc-module <installed @roamhq/wrtc directory>.");
if (!process.env.OPENAI_API_KEY)
  throw new Error("Set OPENAI_API_KEY privately before running this paid eval.");
const native = NodeModule.createRequire(import.meta.url)(
  NodePath.resolve(values["webrtc-module"]),
) as NativeWebRtc;
const count = Number(values.samples);
if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error("Use 1–10 samples.");
const selected = cases.filter((entry) => !values.case || values.case.split(",").includes(entry.id));
if (!selected.length) throw new Error("No matching cases.");
const headers = {
  Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
  "Content-Type": "application/json",
};
const clips = new Map<string, Int16Array>();
const wait = (ms: number) => new Promise<void>((yes) => setTimeout(yes, ms));
async function deadline<A>(promise: Promise<A>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Voice milestone timed out")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function speech(text: string) {
  const cached = clips.get(text);
  if (cached) return cached;
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      input: text,
      response_format: "pcm",
    }),
  });
  if (!response.ok) throw new Error(`Synthetic speech fixture HTTP ${response.status}`);
  const samples = new Int16Array(await response.arrayBuffer());
  clips.set(text, samples);
  return samples;
}
async function run(entry: (typeof cases)[number]) {
  const audio: number[] = [];
  const clipStarts: number[] = [];
  for (const text of entry.clips) {
    clipStarts.push(audio.length / 48);
    const pcm = await speech(text);
    for (const value of pcm) audio.push(value, value);
    audio.push(...new Array<number>(72000).fill(0));
  }
  const peer = new native.RTCPeerConnection({ iceServers: [] });
  const source = new native.nonstandard.RTCAudioSource();
  const track = source.createTrack();
  peer.addTrack(track);
  const channel = peer.createDataChannel("oai-events");
  let sink: Sink | undefined,
    playing = false,
    cursor = 0,
    input = "",
    output = "",
    audibleSamples = 0,
    delegations = 0,
    closed = false,
    playback = false,
    volume = 0.8,
    playedSamples = 0,
    inputActive = false,
    outputActive = false,
    inputQuiet = 0,
    outputQuiet = 0;
  let firstPlayedInputMs: number | null = null;
  let controller: MeetingController | undefined;
  let controllerState: MeetingState | undefined;
  const requests: string[] = [];
  const trace: Record<string, unknown>[] = [];
  const record = (event: Record<string, unknown>) => {
    if (values.controller && trace.length < 400) trace.push({ inputMs: cursor / 48, ...event });
  };
  let eventNumber = 0;
  const types = new Set<string>();
  let started!: () => void, finalized!: () => void;
  const startup = new Promise<void>((yes) => {
    started = yes;
  });
  const closure = new Promise<void>((yes) => {
    finalized = yes;
  });
  channel.onmessage = ({ data }) => {
    const event = JSON.parse(data) as { type: string; delta?: string; delegation?: { id: string } };
    types.add(event.type);
    if (event.type.includes("transcript")) record(event);
    else if (event.type !== "session.usage.updated") record({ type: event.type });
    if (event.type === "session.started") {
      playing = true;
      started();
    }
    if (event.type === "session.input_transcript.delta") input += event.delta ?? "";
    if (event.type === "session.output_transcript.delta") output += event.delta ?? "";
    if (event.type === "session.delegation.created") {
      delegations++;
      if (!controller)
        channel.send(
          JSON.stringify({
            type: "session.thinking.append",
            event_id: `suppress-${delegations}`,
            delegation_id: event.delegation?.id,
            content: "",
          }),
        );
    }
    if (event.type === "session.closed") {
      closed = true;
      finalized();
    }
    controller?.receive(event);
  };
  peer.ontrack = ({ track: remote }) => {
    sink = new native.nonstandard.RTCAudioSink(remote);
    sink.ondata = ({ samples }) => {
      if (samples.some((value) => Math.abs(value) > 100)) audibleSamples += samples.length;
      if (!controller) return;
      const rms = Math.sqrt(
        samples.reduce((sum, value) => sum + (value / 32768) ** 2, 0) / samples.length,
      );
      if (rms > 0.006 && !outputActive) {
        outputActive = true;
        record({ type: "device.output-start", playback });
      }
      outputQuiet = rms > 0.006 ? 0 : outputQuiet + 1;
      if (outputActive && outputQuiet >= 60) {
        outputActive = false;
        record({ type: "device.output-end", playback });
        controller.receive({ type: "device.output-end" });
      }
      if (playback && volume > 0 && rms > 0.006) {
        firstPlayedInputMs ??= cursor / 48;
        playedSamples += samples.length;
      }
      controller.receive({
        type: "device.audio",
        outputActive,
        level: playback ? Math.min(1, rms * volume * 8) : 0,
      });
    };
  };
  const timer = setInterval(() => {
    const samples = new Int16Array(480);
    if (playing)
      for (let i = 0; i < samples.length && cursor < audio.length; i++)
        samples[i] = audio[cursor++]!;
    if (controller) {
      const rms = Math.sqrt(
        samples.reduce((sum, value) => sum + (value / 32768) ** 2, 0) / samples.length,
      );
      if (rms > 0.018 && !inputActive) {
        inputActive = true;
        record({ type: "device.input-start" });
        controller.receive({ type: "device.input-start" });
      }
      inputQuiet = rms > 0.018 ? 0 : inputQuiet + 1;
      if (inputActive && inputQuiet >= 60) {
        inputActive = false;
        record({ type: "device.input-end" });
        controller.receive({ type: "device.input-end" });
      }
    }
    source.onData({
      samples,
      sampleRate: 48000,
      bitsPerSample: 16,
      channelCount: 1,
      numberOfFrames: 480,
    });
  }, 10);
  try {
    await deadline(peer.setLocalDescription(await peer.createOffer()), 10000);
    if (peer.iceGatheringState !== "complete")
      await deadline(
        new Promise<void>((yes) => {
          peer.onicegatheringstatechange = () => {
            if (peer.iceGatheringState === "complete") yes();
          };
        }),
        10000,
      );
    const response = await fetch("https://api.openai.com/v1/live/sessions", {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        session: {
          model: values.model,
          store: false,
          delegation: { type: "client", acknowledgement_delay_ms: 800 },
          instructions: puckoInstructions("Citrus"),
        },
        transport: { type: "webrtc", sdp: peer.localDescription.sdp },
      }),
    });
    if (!response.ok) throw new Error(`GPT-Live HTTP ${response.status}`);
    const answer = (await response.json()) as {
      session: { id: string };
      transport: { sdp: string };
    };
    if (values.controller) {
      const result: MeetingExperimentResult = {
        id: "voice-eval",
        title: "Synthetic voice fixture",
        threadId: null,
        sessionId: answer.session.id,
        sdp: answer.transport.sdp,
        closed: false,
        interrupted: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        endedAt: null,
        activationName: "Citrus",
        summary: "",
        summaryPageId: null,
        requests: [],
        tasks: [],
      };
      controller = new MeetingController(
        result.id,
        {
          offer: async () => peer.localDescription.sdp,
          accept: (sdp) => peer.setRemoteDescription({ type: "answer", sdp }),
          stopCapture: () => {
            playing = false;
          },
          unmute: async () => {
            playing = true;
          },
          setPlayback: (enabled) => {
            playback = enabled;
            record({ type: "playback", enabled });
          },
          setVolume: (value) => {
            volume = value;
          },
          resumePlayback: async () => {},
          send: (event) => channel.send(JSON.stringify(event)),
          close: async () => {
            if (!closed && channel.readyState === "open") {
              channel.send(JSON.stringify({ type: "session.close" }));
              await deadline(closure, 5000);
            }
            return closed;
          },
        },
        async (command) => {
          if (command.action === "invite") {
            requests.push(command.request);
            throw new Error("The voice fixture records handoffs but does not execute Bara tasks.");
          }
          return result;
        },
        (state) => {
          controllerState = state;
        },
        () => `voice-eval-${++eventNumber}`,
      );
      await controller.start(true);
    } else await peer.setRemoteDescription({ type: "answer", sdp: answer.transport.sdp });
    await deadline(startup, 15000);
    await wait(audio.length / 48 + 9000);
    if (controller) await controller.end();
    else channel.send(JSON.stringify({ type: "session.close" }));
    await deadline(closure, 5000);
    return {
      id: entry.id,
      model: values.model,
      input,
      output,
      audibleSamples,
      ...(controller
        ? {
            playedSamples,
            firstPlayedInputMs,
            requests,
            controllerTranscript: controllerState?.transcript,
            controllerError: controllerState?.error,
            diagnostics: controllerState?.diagnostics,
            trace,
          }
        : {}),
      delegations,
      closed,
      types: [...types],
      signalPass:
        Boolean(input.trim()) &&
        closed &&
        (!("waitForLastClip" in entry) ||
          !controller ||
          (firstPlayedInputMs !== null && firstPlayedInputMs >= clipStarts.at(-1)!)) &&
        ("delegation" in entry && entry.delegation
          ? delegations > 0 && (!controller || requests.length === 1)
          : delegations === 0 &&
            (entry.reply
              ? Boolean(output.trim()) && (controller ? playedSamples : audibleSamples) > 0
              : controller
                ? playedSamples === 0
                : !output.trim() && audibleSamples === 0)),
    };
  } finally {
    clearInterval(timer);
    controller?.dispose();
    sink?.stop();
    track.stop();
    channel.close();
    peer.close();
  }
}
await NodeFSP.mkdir(values.out, { recursive: true });
const results = [];
try {
  for (const entry of selected)
    for (let sample = 0; sample < count; sample++) {
      const result = { ...(await run(entry)), sample };
      results.push(result);
      await NodeFSP.writeFile(
        NodePath.resolve(values.out, "results.json"),
        JSON.stringify(results, null, 2),
      );
      process.stdout.write(
        `${entry.id} sample ${sample + 1}: ${result.signalPass ? "signal pass" : "FAIL"}; review transcript for meaning\n`,
      );
    }
  const baseline = values.baseline
    ? await NodeFSP.readFile(NodePath.resolve(values.baseline), "utf8")
    : "No baseline supplied.";
  await NodeFSP.writeFile(
    NodePath.resolve(values.out, "review.md"),
    [
      "# Pucko voice review",
      "Signal checks do not grade semantic correctness. Review replies against each expectation. This eval does not test browser speakers, room echo, permissions, or Bara task execution.",
      ...selected.map((entry) => `- ${entry.id}: ${entry.expectation}`),
      "## Results",
      JSON.stringify(results, null, 2),
      "## Baseline",
      baseline,
      "Cost: inspect the OpenAI usage dashboard. Synthetic fixture TTS and Live duration are billable; no raw audio is retained.",
    ].join("\n\n"),
  );
  process.exitCode = results.every((entry) => entry.signalPass) ? 0 : 1;
} finally {
  // The optional native WebRTC addon can retain threads after every peer has closed.
  process.exit(process.exitCode ?? 0);
}
