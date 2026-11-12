import { describe, expect, it, vi } from "vite-plus/test";
import {
  ThreadId,
  type MeetingExperimentCommand,
  type MeetingExperimentResult,
} from "@t3tools/contracts";
import {
  MeetingController,
  type MeetingClip,
  type MeetingDevice,
  type MeetingState,
} from "./controller.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture() {
  const commands: MeetingExperimentCommand[] = [];
  const clip: MeetingClip = { play: vi.fn(async () => {}), stop: vi.fn(), dispose: vi.fn() };
  const device: MeetingDevice = {
    offer: vi.fn(async () => "offer"),
    accept: vi.fn(async () => {}),
    stopCapture: vi.fn(),
    close: vi.fn(async () => true),
    beginPreview: vi.fn(),
    finishPreview: vi.fn(async () => clip),
  };
  const result: MeetingExperimentResult = {
    id: "meeting",
    threadId: ThreadId.make("work"),
    sessionId: "live-session",
    sdp: "answer",
    closed: false,
    requests: [],
    tasks: [],
  };
  let state: MeetingState | undefined;
  let count = 0;
  const backend = vi.fn(async (command: MeetingExperimentCommand) => {
    commands.push(command);
    return result;
  });
  const controller = new MeetingController(
    "meeting",
    device,
    backend,
    (next) => {
      state = next;
    },
    () => `request-${++count}`,
  );
  const speech = (id: string, delta: string) =>
    controller.receive({
      type: "session.input_transcript.delta",
      event_id: id,
      delta,
      start_ms: 10,
      end_ms: 20,
    });
  const start = async () => {
    await controller.start(result.threadId, true);
    controller.receive({ type: "session.started" });
  };
  return {
    controller,
    device,
    commands,
    backend,
    clip,
    result,
    speech,
    start,
    state: () => state!,
  };
}

describe("meeting consent, invitations and audio isolation", () => {
  it("does not capture without consent or execute overheard requests and delegation events", async () => {
    const f = fixture();
    await f.controller.start(f.result.threadId, false);
    expect(f.device.offer).not.toHaveBeenCalled();
    await f.start();
    f.speech("one", "Citrus, research competitors.");
    f.speech("one", "Citrus, research competitors.");
    f.controller.receive({
      type: "session.delegation.created",
      delegation: { id: "delegation", target: "client" },
    });
    f.controller.receive({
      type: "session.output_transcript.delta",
      event_id: "out",
      delta: "I started researching",
      start_ms: 20,
      end_ms: 30,
    });
    expect(f.commands.map((c) => c.action)).toEqual(["start"]);
    expect(f.state().transcript.match(/research/g)).toHaveLength(1);
    expect(f.clip.play).not.toHaveBeenCalled();
    expect(f.device.beginPreview).not.toHaveBeenCalled();
    await f.controller.submit("Research the two competitors we discussed.");
    expect(f.commands[1]).toMatchObject({
      action: "invite",
      request: "Research the two competitors we discussed.",
      context: f.state().transcript,
    });
    f.speech("two", "While that runs, let's discuss pricing.");
    expect(f.state().phase).toBe("listening");
    expect(f.commands).toHaveLength(2);
  });

  it("retains the exact confirmed context and operation ID on an uncertain retry", async () => {
    const f = fixture();
    await f.start();
    f.speech("one", "Original brief");
    const uncertain = deferred<MeetingExperimentResult>();
    f.backend.mockImplementationOnce((input) => {
      f.commands.push(input);
      return uncertain.promise;
    });
    const send = f.controller.submit("Make a document");
    uncertain.reject(new Error("Reply lost"));
    await send;
    f.speech("two", "Additional discussion is not a new assignment");
    await f.controller.submit("Make a document");
    expect(f.commands[2]).toEqual(f.commands[1]);
  });

  it("stops the microphone synchronously while server cleanup is pending and keeps authorized work", async () => {
    const f = fixture();
    await f.start();
    const blocked = deferred<MeetingExperimentResult>();
    f.backend.mockImplementationOnce((input) => {
      f.commands.push(input);
      return blocked.promise;
    });
    const ending = f.controller.end();
    expect(f.device.stopCapture).toHaveBeenCalled();
    expect(f.state().phase).toBe("ended");
    expect(f.commands.map((c) => c.action)).toEqual(["start", "close"]);
    f.speech("late", "Citrus, delete everything");
    expect(f.state().transcript).toBe("");
    blocked.resolve({ ...f.result, closed: true });
    await ending;
    await f.controller.prepareNotes();
    expect(f.commands.at(-1)?.action).toBe("notes");
    expect(f.commands.some((c) => "action" in c && String(c.action).includes("cancel"))).toBe(
      false,
    );
  });

  it("requires a completed backend result and separate playback consent, and interrupts playback", async () => {
    const f = fixture();
    await f.start();
    f.controller.beginPreview("Invented success");
    expect(f.device.beginPreview).not.toHaveBeenCalled();
    f.backend.mockResolvedValue({
      ...f.result,
      requests: [{ requestId: "one", status: "completed", answer: "Verified answer" }],
    });
    await f.controller.inspect();
    f.controller.beginPreview("Verified answer");
    f.controller.receive({
      type: "session.output_transcript.delta",
      event_id: "out",
      delta: "Verified answer",
      start_ms: 20,
      end_ms: 30,
    });
    await f.controller.finishPreview();
    expect(f.clip.play).not.toHaveBeenCalled();
    await f.controller.playReviewedPreview();
    expect(f.clip.play).toHaveBeenCalledOnce();
    f.speech("interrupt", "Wait, a correction");
    expect(f.clip.stop).toHaveBeenCalled();
    await f.controller.end();
    await f.controller.playReviewedPreview();
    expect(f.clip.play).toHaveBeenCalledOnce();
    expect(f.clip.dispose).toHaveBeenCalled();
  });

  it("releases a late connection after navigation without reactivating capture", async () => {
    const f = fixture();
    const pending = deferred<MeetingExperimentResult>();
    f.backend.mockImplementationOnce((input) => {
      f.commands.push(input);
      return pending.promise;
    });
    const starting = f.controller.start(f.result.threadId, true);
    await vi.waitFor(() => expect(f.commands).toHaveLength(1));
    f.controller.dispose();
    pending.resolve(f.result);
    await starting;
    expect(f.device.accept).not.toHaveBeenCalled();
    expect(f.commands.at(-1)?.action).toBe("close");
    expect(f.device.stopCapture).toHaveBeenCalled();
  });

  it("fails closed on transport errors and bounded transcript exhaustion", async () => {
    const f = fixture();
    await f.start();
    f.speech("large", "x".repeat(60000));
    expect(f.state().phase).toBe("ended");
    expect(f.device.stopCapture).toHaveBeenCalled();
    expect(f.commands).toHaveLength(1);
    const g = fixture();
    await g.start();
    g.controller.receive({ type: "error", error: { message: "sensitive raw payload" } });
    expect(g.state().phase).toBe("ended");
    expect(g.state().error).not.toContain("sensitive");
    expect(g.device.stopCapture).toHaveBeenCalled();
  });
});
