import { expect, it, vi } from "vite-plus/test";
import { BrowserMeetingDevice } from "./browserDevice";

function fixture() {
  let resolve!: (stream: MediaStream) => void;
  const capture = new Promise<MediaStream>((yes) => {
    resolve = yes;
  });
  const stop = vi.fn();
  const track = Object.assign(new EventTarget(), { kind: "audio", stop });
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
  const getUserMedia = vi.fn(() => capture);
  const events = Object.assign(new EventTarget(), {
    readyState: "closed",
    send: vi.fn(),
    close: vi.fn(),
  });
  const replaceTrack = vi.fn(async () => {});
  class Peer extends EventTarget {
    iceGatheringState = "complete";
    localDescription = { sdp: "offer" };
    addTrack = vi.fn(() => ({ replaceTrack }));
    createOffer = vi.fn(async () => ({ type: "offer", sdp: "offer" }));
    setLocalDescription = vi.fn(async () => {});
    setRemoteDescription = vi.fn(async () => {});
    createDataChannel = () => events;
    close = vi.fn();
  }
  const peers: Peer[] = [];
  class Node {
    connect = vi.fn();
    disconnect = vi.fn();
  }
  class Meter extends Node {
    fftSize = 0;
    value = 0;
    getFloatTimeDomainData(buffer: Float32Array) {
      buffer.fill(this.value);
    }
  }
  const meters: Meter[] = [];
  const player = {
    autoplay: false,
    muted: false,
    volume: 1,
    paused: true,
    srcObject: null as unknown,
    play: vi.fn(async () => {
      player.paused = false;
    }),
    pause: vi.fn(() => {
      player.paused = true;
    }),
  };
  vi.stubGlobal("Audio", function Audio() {
    return player;
  });
  const closeContext = vi.fn(async () => {});
  vi.stubGlobal(
    "RTCPeerConnection",
    class extends Peer {
      constructor() {
        super();
        peers.push(this);
      }
    },
  );
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal(
    "MediaStream",
    class {
      tracks: unknown[];
      constructor(tracks: unknown[]) {
        this.tracks = tracks;
      }
      getTracks() {
        return this.tracks;
      }
    },
  );
  vi.stubGlobal(
    "AudioContext",
    class {
      state = "running";
      resume = vi.fn(async () => {});
      close = closeContext;
      createMediaStreamSource = () => new Node();
      createAnalyser = () => {
        const meter = new Meter();
        meters.push(meter);
        return meter;
      };
    },
  );
  const device = new BrowserMeetingDevice();
  return {
    resolve,
    stream,
    stop,
    peers,
    events,
    getUserMedia,
    replaceTrack,
    meters,
    player,
    closeContext,
    device,
    [Symbol.dispose]() {
      void device.close();
      vi.unstubAllGlobals();
    },
  };
}

it("stops a microphone returned after cancellation without adding its tracks to a connection", async () => {
  using f = fixture();
  const abort = new AbortController();
  const offered = f.device.offer(
    () => {},
    () => {},
    abort.signal,
    () => {},
  );
  abort.abort();
  f.resolve(f.stream);
  await expect(offered).rejects.toThrow("canceled");
  expect(f.stop).toHaveBeenCalledOnce();
  expect(f.peers[0]?.addTrack).not.toHaveBeenCalled();
  expect(f.peers[0]?.close).toHaveBeenCalled();
});

it("routes addressed audio to speakers, meters actual output, reacquires muted capture and waits for confirmed closure", async () => {
  using f = fixture();
  vi.useFakeTimers();
  using _timers = { [Symbol.dispose]: () => vi.useRealTimers() };
  const updates = vi.fn();
  const offered = f.device.offer(
    updates,
    () => {},
    new AbortController().signal,
    () => {},
  );
  f.resolve(f.stream);
  expect(await offered).toBe("offer");
  f.peers[0]?.dispatchEvent(
    Object.assign(new Event("track"), { track: { kind: "audio", stop: vi.fn() } }),
  );
  expect(f.player.srcObject).not.toBeNull();
  expect(f.player.muted).toBe(true);
  f.device.setPlayback(true);
  f.device.setVolume(0.5);
  expect(f.player.muted).toBe(false);
  expect(f.player.volume).toBe(0.5);
  await f.device.resumePlayback();
  f.meters[1]!.value = 0.1;
  vi.advanceTimersByTime(50);
  expect(updates).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "device.audio",
      outputActive: true,
      level: expect.closeTo(0.4),
    }),
  );
  f.device.setPlayback(false);
  vi.advanceTimersByTime(50);
  expect(updates).toHaveBeenCalledWith({ type: "device.audio", outputActive: true, level: 0 });
  f.device.stopCapture();
  expect(f.stop).toHaveBeenCalledOnce();
  expect(f.events.send).not.toHaveBeenCalled();
  const nextTrack = Object.assign(new EventTarget(), { kind: "audio", stop: vi.fn() });
  f.getUserMedia.mockResolvedValueOnce({
    getTracks: () => [nextTrack],
    getAudioTracks: () => [nextTrack],
  } as unknown as MediaStream);
  await f.device.unmute(new AbortController().signal);
  expect(f.replaceTrack).toHaveBeenCalledWith(nextTrack);
  f.events.readyState = "open";
  const closed = f.device.close();
  expect(nextTrack.stop).toHaveBeenCalledOnce();
  expect(f.events.send).toHaveBeenCalledWith(JSON.stringify({ type: "session.close" }));
  expect(f.peers[0]?.close).not.toHaveBeenCalled();
  f.events.dispatchEvent(
    new MessageEvent("message", { data: JSON.stringify({ type: "session.closed" }) }),
  );
  expect(await closed).toBe(true);
  expect(f.peers[0]?.close).toHaveBeenCalledOnce();
  expect(f.closeContext).toHaveBeenCalledOnce();
  expect(f.player.pause).toHaveBeenCalled();
  expect(f.player.srcObject).toBeNull();
});

it("reports blocked speaker playback and recovers without granting a new reply", async () => {
  using f = fixture();
  const updates = vi.fn();
  const offered = f.device.offer(
    updates,
    () => {},
    new AbortController().signal,
    () => {},
  );
  f.resolve(f.stream);
  await offered;
  let blocked!: () => void;
  const failure = new Promise<void>((resolve) => {
    blocked = resolve;
  });
  updates.mockImplementation((event: { type: string }) => {
    if (event.type === "device.playback-blocked") blocked();
  });
  f.player.play.mockRejectedValueOnce(new Error("NotAllowedError"));
  f.peers[0]?.dispatchEvent(
    Object.assign(new Event("track"), { track: { kind: "audio", stop: vi.fn() } }),
  );
  await failure;
  expect(f.player.muted).toBe(true);
  await f.device.resumePlayback();
  expect(f.player.muted).toBe(true);
  expect(updates).toHaveBeenLastCalledWith({ type: "device.playback-ready" });
});
