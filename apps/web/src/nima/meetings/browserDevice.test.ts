import { expect, it, vi } from "vite-plus/test";
import { BrowserMeetingDevice } from "./browserDevice";

function fixture() {
  let resolve!: (stream: MediaStream) => void;
  const capture = new Promise<MediaStream>((yes) => {
    resolve = yes;
  });
  const stop = vi.fn();
  const track = Object.assign(new EventTarget(), { stop });
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const events = Object.assign(new EventTarget(), { readyState: "closed", send: vi.fn() });
  class Peer extends EventTarget {
    iceGatheringState = "complete";
    localDescription = { sdp: "offer" };
    addTrack = vi.fn();
    createOffer = vi.fn(async () => ({ type: "offer", sdp: "offer" }));
    setLocalDescription = vi.fn(async () => {});
    createDataChannel = () => events;
    close = vi.fn();
  }
  const peers: Peer[] = [];
  vi.stubGlobal(
    "RTCPeerConnection",
    class extends Peer {
      constructor() {
        super();
        peers.push(this);
      }
    },
  );
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: () => capture } });
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
  const audio = vi.fn();
  vi.stubGlobal("Audio", audio);
  return {
    resolve,
    stream,
    stop,
    peers,
    events,
    audio,
    [Symbol.dispose]: () => vi.unstubAllGlobals(),
  };
}

it("stops a microphone returned after cancellation without adding its tracks to a connection", async () => {
  using f = fixture();
  const device = new BrowserMeetingDevice();
  const abort = new AbortController();
  const offered = device.offer(
    () => {},
    () => {},
    abort.signal,
  );
  abort.abort();
  f.resolve(f.stream);
  await expect(offered).rejects.toThrow("canceled");
  expect(f.stop).toHaveBeenCalledOnce();
  expect(f.peers[0]?.addTrack).not.toHaveBeenCalled();
  expect(f.peers[0]?.close).toHaveBeenCalled();
});

it("never connects unsolicited remote audio to playback and stops capture before any remote cleanup", async () => {
  using f = fixture();
  const device = new BrowserMeetingDevice();
  const offered = device.offer(
    () => {},
    () => {},
    new AbortController().signal,
  );
  f.resolve(f.stream);
  expect(await offered).toBe("offer");
  f.peers[0]?.dispatchEvent(Object.assign(new Event("track"), { track: { stop: vi.fn() } }));
  expect(f.audio).not.toHaveBeenCalled();
  device.stopCapture();
  expect(f.stop).toHaveBeenCalledOnce();
  expect(f.events.send).not.toHaveBeenCalled();
  expect(await device.close()).toBe(false);
  expect(f.peers[0]?.close).toHaveBeenCalled();
});
