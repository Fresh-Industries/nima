import { useEffect, useRef, useState } from "react";
import {
  Camera,
  Download,
  ImagePlus,
  Mic,
  Monitor,
  Plus,
  Radio,
  Square,
  Trash2,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import styles from "./Studio.module.css";
import { Input } from "../../components/ui/input";
import { randomUUID } from "../../lib/utils";
import { useStableCallback } from "../../hooks/useStableCallback";
import { StudioChoice, StudioField, StudioNumber } from "./Controls";
import { colorHex, hexColor, jsonRecord, type LiveCollection, type LiveSource } from "./model";
import { useStudio, downloadStudioExport, type StudioSession } from "./useStudio";
import { studioImage } from "./imageImport";
import { publishWhip, type WhipPublisher } from "./whip";
import { setLiveActivity } from "./liveActivity";

type Feed = { stream: MediaStream; video: HTMLVideoElement; audio?: MediaStreamAudioSourceNode };
type Mix = {
  context: AudioContext;
  destination: MediaStreamAudioDestinationNode;
  gain: GainNode;
  tone: OscillatorNode;
  toneGain: GainNode;
};
const canvasColor = (color: readonly number[]) =>
  `rgba(${color[0]},${color[1]},${color[2]},${(color[3] ?? 255) / 255})`;
function source(name: string, content: LiveSource["content"], id = randomUUID()): LiveSource {
  return {
    id,
    name,
    content,
    visible: true,
    locked: false,
    transform: { bounds: { x: 0, y: 0, w: 640, h: 360 }, rotation: 0, opacity: 1 },
  };
}
export function StudioLive({ catalog }: { catalog: StudioSession }) {
  const session = useStudio({ scope: "live" }, catalog.environmentId ?? undefined);
  const remoteCollection = session.query.data?.data as LiveCollection | null | undefined;
  const [retainedCollection, setRetainedCollection] = useState<LiveCollection | null>(
    remoteCollection ?? null,
  );
  const collection = remoteCollection ?? retainedCollection;
  if (remoteCollection && remoteCollection !== retainedCollection)
    setRetainedCollection(remoteCollection);
  const scene = collection?.scenes.find((scene) => scene.id === collection.program);
  const [selected, setSelected] = useState<string | null>(null);
  const selectedSource = scene?.sources.find((source) => source.id === selected);
  const [connected, setConnected] = useState<string[]>([]);
  const [mic, setMic] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [broadcast, setBroadcast] = useState<"idle" | "connecting" | "live">("idle");
  const [endpoint, setEndpoint] = useState("");
  const [token, setToken] = useState("");
  const [mediaError, setMediaError] = useState("");
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const feeds = useRef(new Map<string, Feed>());
  const microphone = useRef<{ stream: MediaStream; audio: MediaStreamAudioSourceNode } | null>(
    null,
  );
  const mix = useRef<Mix | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const publisher = useRef<WhipPublisher | null>(null);
  const broadcastAbort = useRef<AbortController | null>(null);
  const images = useRef(new Map<string, HTMLImageElement>());
  const upload = useRef<HTMLInputElement>(null);
  const active = session.canWrite && !session.busy && Boolean(collection);
  const disconnect = (id: string) => {
    const feed = feeds.current.get(id);
    feeds.current.delete(id);
    feed?.stream.getTracks().forEach((track) => track.stop());
    feed?.audio?.disconnect();
    if (feed) {
      feed.video.pause();
      feed.video.srcObject = null;
    }
    setConnected((current) => current.filter((value) => value !== id));
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- exposes owned recording and broadcast activity to navigation without moving the media session
  useEffect(() => {
    if (!session.environmentId) return;
    setLiveActivity(
      session.environmentId,
      recording,
      broadcast !== "idle",
      connected.length > 0 || mic,
    );
    return () => setLiveActivity(session.environmentId!, false, false);
  }, [session.environmentId, recording, broadcast, connected, mic]);
  const edit = (payload: unknown, revision?: number) =>
    session.write("live", revision ?? collection?.revision ?? 0, payload);
  const ensureMix = () => {
    if (!mix.current) {
      const context = new AudioContext();
      const destination = context.createMediaStreamDestination();
      const gain = context.createGain();
      gain.connect(destination);
      const tone = context.createOscillator();
      const toneGain = context.createGain();
      toneGain.gain.value = 0;
      tone.connect(toneGain);
      toneGain.connect(gain);
      tone.start();
      mix.current = { context, destination, gain, tone, toneGain };
      setAudioReady(true);
    }
    void mix.current.context.resume();
    return mix.current;
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns device tracks, recording, audio graph, and the explicit broadcast for this mounted Live workspace
  useEffect(
    () => () => {
      broadcastAbort.current?.abort();
      void publisher.current?.stop().catch(() => undefined);
      if (recorder.current?.state === "recording") recorder.current.stop();
      for (const feed of feeds.current.values()) {
        feed.stream.getTracks().forEach((track) => track.stop());
        feed.audio?.disconnect();
      }
      microphone.current?.stream.getTracks().forEach((track) => track.stop());
      void mix.current?.context.close();
    },
    [],
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- applies saved program audio settings to the browser's real recording and broadcast mix
  useEffect(() => {
    const current = mix.current;
    if (!current || !scene || !audioReady) return;
    current.gain.gain.value = scene.audio.muted ? 0 : scene.audio.gain;
    current.tone.frequency.value = scene.audio.tone_hz ?? 440;
    current.toneGain.gain.value = scene.audio.tone_hz ? 0.05 : 0;
  }, [scene, audioReady]);
  const paint = () => {
    const target = canvas.current;
    if (!target || !collection || !scene) return;
    const context = target.getContext("2d");
    if (!context) return;
    context.setTransform(
      target.width / collection.width,
      0,
      0,
      target.height / collection.height,
      0,
      0,
    );
    context.globalAlpha = 1;
    context.clearRect(0, 0, collection.width, collection.height);
    context.fillStyle = canvasColor(scene.background);
    context.fillRect(0, 0, collection.width, collection.height);
    for (const source of scene.sources) {
      if (!source.visible) continue;
      const b = source.transform.bounds;
      context.save();
      context.globalAlpha = source.transform.opacity;
      context.translate(b.x + b.w / 2, b.y + b.h / 2);
      context.rotate((source.transform.rotation * Math.PI) / 180);
      context.translate(-b.w / 2, -b.h / 2);
      if (source.content.kind === "capture") {
        const feed = feeds.current.get(source.id);
        if (feed && feed.video.readyState >= 2) context.drawImage(feed.video, 0, 0, b.w, b.h);
        else {
          context.fillStyle = "#000000";
          context.fillRect(0, 0, b.w, b.h);
        }
      } else if (source.content.kind === "solid") {
        context.fillStyle = canvasColor(source.content.color ?? [0, 0, 0, 255]);
        context.fillRect(0, 0, b.w, b.h);
      } else if (source.content.kind === "text") {
        context.fillStyle = canvasColor(source.content.color ?? [255, 255, 255, 255]);
        context.font = `${source.content.size ?? 28}px ${source.content.font === "mono" ? "monospace" : source.content.font === "serif" ? "serif" : "sans-serif"}`;
        context.textBaseline = "top";
        const lines = (source.content.text ?? "").split("\n");
        lines.forEach((line, index) =>
          context.fillText(line, 0, index * (source.content.size ?? 28) * 1.2, b.w),
        );
      } else if (source.content.kind === "image") {
        const asset = collection.images.find((image) => image.id === source.content.asset);
        if (asset) {
          const image = images.current.get(asset.id);
          if (image?.complete && image.naturalWidth) context.drawImage(image, 0, 0, b.w, b.h);
        }
      } else if (source.content.kind === "pattern") {
        const colors = [
          "#ebebeb",
          "#ebeb10",
          "#10ebeb",
          "#10eb10",
          "#eb10eb",
          "#eb1010",
          "#1010eb",
          "#101010",
        ];
        for (let index = 0; index < 8; index++) {
          context.fillStyle = colors[index]!;
          context.fillRect((index * b.w) / 8, 0, b.w / 8, b.h);
        }
      }
      context.restore();
    }
  };
  const paintStable = useStableCallback(paint);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- redraws the current program when its embedded images finish decoding
  useEffect(() => {
    const visible = new Set(
      scene?.sources
        .filter((source) => source.visible && source.content.kind === "image")
        .map((source) => source.content.asset),
    );
    for (const [id, image] of images.current)
      if (!visible.has(id)) {
        image.removeEventListener("load", paintStable);
        images.current.delete(id);
      }
    for (const asset of collection?.images.filter((image) => visible.has(image.id)) ?? []) {
      let image = images.current.get(asset.id);
      if (!image) {
        image = new window.Image();
        images.current.set(asset.id, image);
        image.src = `data:image/png;base64,${asset.png_base64}`;
      }
      image.addEventListener("load", paintStable, { once: true });
    }
    paintStable();
    return () => {
      for (const image of images.current.values()) image.removeEventListener("load", paintStable);
    };
  }, [collection?.images, scene, paintStable]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- updates real Live video at 30 fps only while device capture, recording, or broadcasting is active
  useEffect(() => {
    if (!collection) return;
    paintStable();
    if (!connected.length && !recording && broadcast === "idle") return;
    let request = 0,
      last = 0;
    const frame = (at: number) => {
      if (at - last >= 1000 / 30) {
        paintStable();
        last = at;
      }
      request = requestAnimationFrame(frame);
    };
    request = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(request);
  }, [collection, connected, recording, broadcast, paintStable]);
  const connect = async (kind: "screen" | "camera", existing?: string) => {
    setMediaError("");
    let owned: MediaStream | null = null;
    try {
      const audio = ensureMix();
      const stream =
        kind === "screen"
          ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
          : await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      owned = stream;
      const id = existing ?? randomUUID();
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();
      const feed: Feed = { stream, video };
      if (stream.getAudioTracks().length) {
        feed.audio = audio.context.createMediaStreamSource(stream);
        feed.audio.connect(audio.gain);
      }
      if (!existing) {
        const item = source(kind === "screen" ? "Screen" : "Camera", { kind: "capture" }, id);
        if (kind === "camera") item.transform.bounds = { x: 440, y: 210, w: 180, h: 135 };
        const result = await edit({ op: "add_source", scene: scene!.id, source: item });
        if (!result) {
          stream.getTracks().forEach((track) => track.stop());
          feed.audio?.disconnect();
          return;
        }
      }
      const old = feeds.current.get(id);
      old?.stream.getTracks().forEach((track) => track.stop());
      old?.audio?.disconnect();
      feeds.current.set(id, feed);
      owned = null;
      setConnected((current) => [...new Set([...current, id])]);
      setSelected(id);
      for (const track of stream.getVideoTracks())
        track.addEventListener(
          "ended",
          () => {
            if (feeds.current.get(id) !== feed) return;
            feed.audio?.disconnect();
            stream.getTracks().forEach((track) => track.stop());
            video.pause();
            video.srcObject = null;
            feeds.current.delete(id);
            setConnected((current) => current.filter((value) => value !== id));
          },
          { once: true },
        );
    } catch (cause) {
      owned?.getTracks().forEach((track) => track.stop());
      setMediaError(cause instanceof Error ? cause.message : "Could not connect this source.");
    }
  };
  const toggleMic = async () => {
    setMediaError("");
    if (microphone.current) {
      microphone.current.audio.disconnect();
      microphone.current.stream.getTracks().forEach((track) => track.stop());
      microphone.current = null;
      setMic(false);
      return;
    }
    try {
      const audio = ensureMix();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const node = audio.context.createMediaStreamSource(stream);
      node.connect(audio.gain);
      microphone.current = { stream, audio: node };
      setMic(true);
      for (const track of stream.getAudioTracks())
        track.addEventListener(
          "ended",
          () => {
            if (microphone.current?.stream !== stream) return;
            node.disconnect();
            microphone.current = null;
            setMic(false);
          },
          { once: true },
        );
    } catch (cause) {
      setMediaError(cause instanceof Error ? cause.message : "Could not connect the microphone.");
    }
  };
  const programStream = () => {
    const target = canvas.current;
    if (!target) throw new Error("The program canvas is not ready.");
    const audio = ensureMix();
    const stream = target.captureStream(30);
    for (const track of audio.destination.stream.getAudioTracks()) stream.addTrack(track.clone());
    return stream;
  };
  const record = () => {
    setMediaError("");
    if (recorder.current?.state === "recording") {
      recorder.current.stop();
      return;
    }
    let owned: MediaStream | null = null;
    try {
      const stream = programStream();
      owned = stream;
      const mimeType = [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
        "video/mp4",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType) {
        stream.getTracks().forEach((track) => track.stop());
        setMediaError("This browser cannot record the program.");
        return;
      }
      const current = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
      const chunks: Blob[] = [];
      let bytes = 0;
      current.ondataavailable = (event) => {
        if (event.data.size) {
          chunks.push(event.data);
          bytes += event.data.size;
          if (bytes > 512 * 1024 * 1024 && current.state === "recording") {
            current.stop();
            setMediaError("The recording reached the browser’s memory limit and was saved.");
          }
        }
      };
      current.onstop = () => {
        setRecording(false);
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `bara-live-${new Date().toISOString().replaceAll(":", "-")}.${mimeType.startsWith("video/mp4") ? "mp4" : "webm"}`;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      };
      current.onerror = () => {
        setMediaError("Recording stopped because the browser reported an error.");
        if (current.state === "recording") current.stop();
      };
      recorder.current = current;
      current.start(1000);
      owned = null;
      setRecording(true);
    } catch (cause) {
      owned?.getTracks().forEach((track) => track.stop());
      setMediaError(cause instanceof Error ? cause.message : "Recording could not start.");
    }
  };
  const goLive = async () => {
    setMediaError("");
    if (broadcast !== "idle") {
      broadcastAbort.current?.abort();
      try {
        await publisher.current?.stop();
      } catch {
        setMediaError("The local broadcast stopped; the destination did not confirm cleanup.");
      }
      publisher.current = null;
      setBroadcast("idle");
      return;
    }
    try {
      const abort = new AbortController();
      broadcastAbort.current = abort;
      const stream = programStream();
      setBroadcast("connecting");
      publisher.current = await publishWhip(stream, endpoint, token, abort.signal, (state) => {
        if (state === "connected") setBroadcast("live");
        else if (state === "failed") {
          abort.abort();
          void publisher.current?.stop().catch(() => undefined);
          publisher.current = null;
          setMediaError("The broadcast connection failed.");
          setBroadcast("idle");
        } else if (state === "closed") setBroadcast("idle");
      });
      if (abort.signal.aborted) {
        await publisher.current.stop();
        publisher.current = null;
      }
    } catch (cause) {
      setBroadcast("idle");
      setMediaError(cause instanceof Error ? cause.message : "The broadcast could not connect.");
    }
  };
  const addImage = async (file: File) => {
    try {
      const image = await studioImage(file);
      const result = await edit({ op: "add_image", image });
      if (
        result &&
        typeof result === "object" &&
        !Array.isArray(result) &&
        typeof jsonRecord(result).revision === "number"
      ) {
        const item = source(file.name, { kind: "image", asset: image.id });
        const scale = Math.min(640 / image.width, 360 / image.height);
        item.transform.bounds = { x: 0, y: 0, w: image.width * scale, h: image.height * scale };
        await edit(
          { op: "add_source", scene: scene!.id, source: item },
          jsonRecord(result).revision as number,
        );
        setSelected(item.id);
      }
    } catch (cause) {
      setMediaError(cause instanceof Error ? cause.message : "Image import failed.");
    }
  };
  if (!collection)
    return (
      <div className="m-auto max-w-md space-y-4 p-8 text-center">
        <Radio className="mx-auto" size={30} strokeWidth={1.2} />
        <h2 className="text-xl font-medium">Your live studio</h2>
        <p className="text-sm text-muted-foreground">
          Arrange scenes, share a screen or camera, record locally, and broadcast to a WHIP
          provider.
        </p>
        <Button
          disabled={!catalog.canWrite || catalog.busy}
          onClick={() =>
            void catalog.write(
              "create",
              (catalog.query.data?.data as { revision?: number } | null)?.revision ?? 0,
              {},
              { area: "live" },
            )
          }
        >
          <Plus />
          Create scene collection
        </Button>
      </div>
    );
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Live studio">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={sourcesOpen}
            onClick={() => setSourcesOpen(!sourcesOpen)}
          >
            Scenes & sources
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={propertiesOpen}
            onClick={() => setPropertiesOpen(!propertiesOpen)}
          >
            Mix & properties
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!active}
            onClick={() => void connect("screen")}
          >
            <Monitor />
            Share screen
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!active}
            onClick={() => void connect("camera")}
          >
            <Camera />
            Camera
          </Button>
          <Button
            size="sm"
            variant={mic ? "secondary" : "outline"}
            aria-pressed={mic}
            disabled={!active && !mic}
            onClick={() => void toggleMic()}
          >
            <Mic />
            {mic ? "Mic on" : "Microphone"}
          </Button>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={recording ? "destructive" : "outline"}
            disabled={!recording && (!active || typeof MediaRecorder === "undefined")}
            onClick={record}
          >
            {recording ? <Square /> : <Radio />}
            {recording ? "Stop recording" : "Record"}
          </Button>
          <span
            className={styles.liveState}
            data-active={recording || broadcast !== "idle"}
            role="status"
            aria-live="polite"
          >
            {broadcast === "live"
              ? recording
                ? "Live broadcast · Recording"
                : "Live broadcast"
              : broadcast === "connecting"
                ? "Connecting…"
                : recording
                  ? "Recording to this device"
                  : "Not live · Not recording"}
          </span>
        </div>
      </header>
      {(mediaError || session.error || session.query.error) && (
        <p role="alert" className="border-b border-border px-4 py-3 text-sm text-destructive">
          {mediaError || session.error || session.query.error}
        </p>
      )}
      <div className={styles.canvasBody}>
        <aside
          className={`${styles.panel} ${styles.layers} ${!sourcesOpen ? styles.panelHidden : ""} gap-4`}
          aria-label="Scenes and sources"
        >
          <Button
            size="xs"
            variant="ghost"
            aria-label="Close scenes and sources"
            onClick={() => setSourcesOpen(false)}
          >
            Close sources
          </Button>
          <section className="space-y-2">
            <h2 className="text-xs font-medium text-muted-foreground">Scenes</h2>
            {collection.scenes.map((candidate) => (
              <div key={candidate.id} className="flex items-center gap-1">
                <div className="min-w-0 flex-1">
                  <Button
                    size="sm"
                    variant={candidate.id === scene?.id ? "secondary" : "ghost"}
                    disabled={!active}
                    onClick={() => {
                      setSelected(null);
                      void edit({ op: "cut", scene: candidate.id });
                    }}
                  >
                    {candidate.name}
                  </Button>
                </div>
                {candidate.id !== collection.program && (
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Remove ${candidate.name}`}
                    disabled={!active}
                    onClick={async () => {
                      const result = await edit({ op: "remove_scene", scene: candidate.id });
                      if (result) for (const item of candidate.sources) disconnect(item.id);
                    }}
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
            ))}
            <Button
              size="sm"
              variant="ghost"
              disabled={!active}
              onClick={() =>
                void edit({
                  op: "add_scene",
                  scene: {
                    id: randomUUID(),
                    name: `Scene ${collection.scenes.length + 1}`,
                    background: [20, 20, 25, 255],
                    sources: [],
                    audio: { tone_hz: null, gain: 1, muted: false },
                  },
                })
              }
            >
              <Plus />
              Add scene
            </Button>
          </section>
          <section className="space-y-2 border-t border-border/60 pt-4">
            <h2 className="text-xs font-medium text-muted-foreground">Sources</h2>
            {scene?.sources
              .slice()
              .reverse()
              .map((item) => (
                <button
                  key={item.id}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-xs outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${selected === item.id ? "bg-accent" : ""}`}
                  onClick={() => setSelected(item.id)}
                >
                  <span className="truncate">{item.name}</span>
                  <span className="text-muted-foreground">
                    {item.content.kind === "capture"
                      ? connected.includes(item.id)
                        ? "On"
                        : "Off"
                      : item.visible
                        ? ""
                        : "Hidden"}
                  </span>
                </button>
              ))}
            <div className="flex flex-wrap gap-2">
              <Button
                size="xs"
                variant="outline"
                disabled={!active}
                onClick={() => {
                  const item = source("Title", {
                    kind: "text",
                    text: "Your title",
                    font: "sans",
                    size: 28,
                    color: [255, 255, 255, 255],
                  });
                  item.transform.bounds = { x: 24, y: 280, w: 590, h: 60 };
                  void edit({ op: "add_source", scene: scene!.id, source: item });
                  setSelected(item.id);
                }}
              >
                Text
              </Button>
              <Button
                size="xs"
                variant="outline"
                disabled={!active}
                onClick={() =>
                  void edit({
                    op: "add_source",
                    scene: scene!.id,
                    source: source("Color", { kind: "solid", color: [70, 55, 90, 255] }),
                  })
                }
              >
                Color
              </Button>
              <Button
                size="icon-xs"
                variant="outline"
                aria-label="Add image source"
                disabled={!active}
                onClick={() => upload.current?.click()}
              >
                <ImagePlus />
              </Button>
              <input
                type="file"
                ref={upload}
                accept="image/png,image/jpeg"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void addImage(file);
                  event.target.value = "";
                }}
              />
            </div>
          </section>
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
          <div className="flex min-h-48 flex-1 items-center justify-center overflow-hidden rounded-lg bg-black">
            <canvas
              ref={canvas}
              width={1280}
              height={720}
              className="max-h-full w-full object-contain"
              aria-label="Live program preview"
            />
          </div>
          <details
            open={broadcast !== "idle" || undefined}
            className="space-y-3 border-t border-border/60 pt-4"
            aria-label="Broadcast destination"
          >
            <summary className="cursor-pointer text-sm font-medium">
              {broadcast !== "idle" ? "Broadcast controls" : "Set up streaming"}
            </summary>
            <p className="text-xs text-muted-foreground">
              Use your streaming provider’s HTTPS WHIP endpoint. Recording downloads directly to
              this device.
            </p>
            <div className="grid grid-cols-1 gap-3 @min-[44rem]/studio:grid-cols-2">
              <StudioField label="WHIP endpoint">
                <Input
                  type="url"
                  aria-label="WHIP endpoint"
                  placeholder="https://…"
                  value={endpoint}
                  disabled={broadcast !== "idle"}
                  onChange={(event) => setEndpoint(event.target.value)}
                />
              </StudioField>
              <StudioField label="Bearer token (if required)">
                <Input
                  type="password"
                  aria-label="Broadcast bearer token"
                  autoComplete="off"
                  value={token}
                  disabled={broadcast !== "idle"}
                  onChange={(event) => setToken(event.target.value)}
                />
              </StudioField>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                size="sm"
                variant={broadcast !== "idle" ? "destructive" : "default"}
                disabled={broadcast === "idle" && (!session.canWrite || !endpoint.trim())}
                onClick={() => void goLive()}
              >
                {broadcast !== "idle" ? <Square /> : <Radio />}
                {broadcast !== "idle" ? "Stop broadcast" : "Go live"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={
                  !active ||
                  scene?.sources.some(
                    (source) => source.visible && source.content.kind === "capture",
                  )
                }
                title="Exports the saved Rust-composited scene without browser device feeds."
                onClick={() =>
                  void session
                    .download({ kind: "live", expectedRevision: collection.revision, frame: 150 })
                    .then((result) => result && downloadStudioExport(result))
                }
              >
                <Download />
                Export 5-second scene clip
              </Button>
            </div>
          </details>
        </div>
        <aside
          className={`${styles.panel} ${!propertiesOpen ? styles.panelHidden : ""} space-y-4`}
          aria-label="Live properties"
        >
          <Button
            size="xs"
            variant="ghost"
            aria-label="Close live properties"
            onClick={() => setPropertiesOpen(false)}
          >
            Close properties
          </Button>
          {scene && (
            <>
              <StudioField label="Scene name">
                <Input
                  key={scene.id + scene.name}
                  size="sm"
                  aria-label="Scene name"
                  defaultValue={scene.name}
                  disabled={!active}
                  onBlur={(event) => {
                    if (event.target.value.trim() && event.target.value !== scene.name)
                      void edit({ op: "rename_scene", scene: scene.id, name: event.target.value });
                  }}
                />
              </StudioField>

              <section className="space-y-3 border-t border-border/60 pt-4">
                <h3 className="text-xs font-medium">Audio mix</h3>
                <StudioNumber
                  label="Program volume"
                  value={scene.audio.gain}
                  min={0}
                  max={2}
                  step={0.1}
                  disabled={!active}
                  onCommit={(gain) =>
                    void edit({ op: "audio", scene: scene.id, audio: { ...scene.audio, gain } })
                  }
                />
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!active}
                  onClick={() =>
                    void edit({
                      op: "audio",
                      scene: scene.id,
                      audio: { ...scene.audio, muted: !scene.audio.muted },
                    })
                  }
                >
                  {scene.audio.muted ? "Unmute program" : "Mute program"}
                </Button>
                {scene.audio.tone_hz && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Generated test tone: {scene.audio.tone_hz} Hz
                    </p>
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={!active}
                      onClick={() =>
                        void edit({
                          op: "audio",
                          scene: scene.id,
                          audio: { ...scene.audio, tone_hz: null },
                        })
                      }
                    >
                      Disable test tone
                    </Button>
                  </div>
                )}
              </section>
            </>
          )}
          {selectedSource && scene && (
            <section className="space-y-3 border-t border-border/60 pt-4">
              <h3 className="text-xs font-medium">{selectedSource.name}</h3>
              <StudioField label="Source name">
                <Input
                  size="sm"
                  key={selectedSource.id + selectedSource.name}
                  aria-label="Source name"
                  defaultValue={selectedSource.name}
                  disabled={!active || selectedSource.locked}
                  onBlur={(event) => {
                    if (event.target.value.trim() && event.target.value !== selectedSource.name)
                      void edit({
                        op: "source",
                        scene: scene.id,
                        source: selectedSource.id,
                        change: { op: "rename", name: event.target.value },
                      });
                  }}
                />
              </StudioField>
              <StudioNumber
                label="Rotation"
                value={selectedSource.transform.rotation}
                min={-360}
                max={360}
                disabled={!active || selectedSource.locked}
                onCommit={(rotation) =>
                  void edit({
                    op: "source",
                    scene: scene.id,
                    source: selectedSource.id,
                    change: {
                      op: "transform",
                      transform: { ...selectedSource.transform, rotation },
                    },
                  })
                }
              />
              {selectedSource.content.kind === "text" && (
                <>
                  <StudioNumber
                    label="Font size"
                    value={selectedSource.content.size ?? 28}
                    min={1}
                    max={512}
                    disabled={!active || selectedSource.locked}
                    onCommit={(size) =>
                      void edit({
                        op: "source",
                        scene: scene.id,
                        source: selectedSource.id,
                        change: { op: "content", content: { ...selectedSource.content, size } },
                      })
                    }
                  />
                  <StudioChoice
                    label="Font"
                    value={selectedSource.content.font ?? "sans"}
                    options={["sans", "serif", "mono"]}
                    disabled={!active || selectedSource.locked}
                    onChange={(font) =>
                      void edit({
                        op: "source",
                        scene: scene.id,
                        source: selectedSource.id,
                        change: { op: "content", content: { ...selectedSource.content, font } },
                      })
                    }
                  />
                </>
              )}
              {(selectedSource.content.kind === "solid" ||
                selectedSource.content.kind === "text") && (
                <StudioField label="Color">
                  <input
                    type="color"
                    aria-label="Source color"
                    key={
                      selectedSource.id +
                      colorHex(selectedSource.content.color ?? [255, 255, 255, 255])
                    }
                    defaultValue={colorHex(selectedSource.content.color ?? [255, 255, 255, 255])}
                    disabled={!active || selectedSource.locked}
                    className="h-8 w-full cursor-pointer rounded-md border border-border bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    onBlur={(event) =>
                      void edit({
                        op: "source",
                        scene: scene.id,
                        source: selectedSource.id,
                        change: {
                          op: "content",
                          content: {
                            ...selectedSource.content,
                            color: hexColor(event.target.value),
                          },
                        },
                      })
                    }
                  />
                </StudioField>
              )}
              {connected.includes(selectedSource.id) && (
                <Button size="xs" variant="outline" onClick={() => disconnect(selectedSource.id)}>
                  Disconnect source
                </Button>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!active || selectedSource.locked}
                  onClick={() =>
                    void edit({
                      op: "source",
                      scene: scene.id,
                      source: selectedSource.id,
                      change: { op: "reorder", index: 0 },
                    })
                  }
                >
                  Send to back
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!active || selectedSource.locked}
                  onClick={() =>
                    void edit({
                      op: "source",
                      scene: scene.id,
                      source: selectedSource.id,
                      change: { op: "reorder", index: scene.sources.length - 1 },
                    })
                  }
                >
                  Bring to front
                </Button>
              </div>
              {selectedSource.content.kind === "capture" &&
                !connected.includes(selectedSource.id) && (
                  <div className="flex gap-2">
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={!active}
                      onClick={() => void connect("screen", selectedSource.id)}
                    >
                      Screen
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={!active}
                      onClick={() => void connect("camera", selectedSource.id)}
                    >
                      Camera
                    </Button>
                  </div>
                )}
              {selectedSource.content.kind === "text" && (
                <StudioField label="Text">
                  <Input
                    key={selectedSource.id + selectedSource.content.text}
                    size="sm"
                    aria-label="Overlay text"
                    defaultValue={selectedSource.content.text ?? ""}
                    disabled={!active}
                    onBlur={(event) => {
                      if (event.target.value !== selectedSource.content.text)
                        void edit({
                          op: "source",
                          scene: scene.id,
                          source: selectedSource.id,
                          change: {
                            op: "content",
                            content: { ...selectedSource.content, text: event.target.value },
                          },
                        });
                    }}
                  />
                </StudioField>
              )}
              <div className="grid grid-cols-2 gap-2">
                {(["x", "y", "w", "h"] as const).map((key) => (
                  <StudioNumber
                    key={key}
                    label={{ x: "X", y: "Y", w: "Width", h: "Height" }[key]}
                    value={selectedSource.transform.bounds[key]}
                    min={key === "w" || key === "h" ? 1 : -100000}
                    max={100000}
                    disabled={!active || selectedSource.locked}
                    onCommit={(value) =>
                      void edit({
                        op: "source",
                        scene: scene.id,
                        source: selectedSource.id,
                        change: {
                          op: "transform",
                          transform: {
                            ...selectedSource.transform,
                            bounds: { ...selectedSource.transform.bounds, [key]: value },
                          },
                        },
                      })
                    }
                  />
                ))}
              </div>
              <StudioNumber
                label="Opacity (%)"
                value={selectedSource.transform.opacity * 100}
                min={0}
                max={100}
                disabled={!active || selectedSource.locked}
                onCommit={(opacity) =>
                  void edit({
                    op: "source",
                    scene: scene.id,
                    source: selectedSource.id,
                    change: {
                      op: "transform",
                      transform: { ...selectedSource.transform, opacity: opacity / 100 },
                    },
                  })
                }
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!active}
                  onClick={() =>
                    void edit({
                      op: "source",
                      scene: scene.id,
                      source: selectedSource.id,
                      change: { op: "visible", visible: !selectedSource.visible },
                    })
                  }
                >
                  {selectedSource.visible ? "Hide" : "Show"}
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!active}
                  onClick={() =>
                    void edit({
                      op: "source",
                      scene: scene.id,
                      source: selectedSource.id,
                      change: { op: "locked", locked: !selectedSource.locked },
                    })
                  }
                >
                  {selectedSource.locked ? "Unlock" : "Lock"}
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Remove source"
                  disabled={!active || selectedSource.locked}
                  onClick={() => {
                    disconnect(selectedSource.id);
                    void edit({
                      op: "source",
                      scene: scene.id,
                      source: selectedSource.id,
                      change: { op: "remove" },
                    });
                    setSelected(null);
                  }}
                >
                  <Trash2 />
                </Button>
              </div>
            </section>
          )}
        </aside>
      </div>
    </section>
  );
}
