import { expect, it, vi } from "vite-plus/test";
import { type MeetingExperimentCommand, type MeetingExperimentResult } from "@t3tools/contracts";
import {
  initialMeetingState,
  isPuckoAddress,
  MeetingController,
  type MeetingDevice,
  type MeetingState,
} from "./controller.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function fixture() {
  const commands: MeetingExperimentCommand[] = [];
  const device: MeetingDevice = {
    offer: vi.fn(async () => "offer"),
    accept: vi.fn(async () => {}),
    stopCapture: vi.fn(),
    unmute: vi.fn(async () => {}),
    setPlayback: vi.fn(),
    setVolume: vi.fn(),
    send: vi.fn(),
    close: vi.fn(async () => true),
  };
  const result: MeetingExperimentResult = {
    id: "meeting",
    title: "Meeting",
    threadId: null,
    sessionId: "live",
    sdp: "answer",
    closed: false,
    interrupted: false,
    createdAt: "2026-11-12T00:00:00.000Z",
    endedAt: null,
    activationName: "Citrus",
    summary: "",
    summaryPageId: null,
    requests: [],
    tasks: [],
  };
  let state: MeetingState = initialMeetingState,
    count = 0;
  const backend = vi.fn(async (command: MeetingExperimentCommand) => {
    commands.push(command);
    return result;
  });
  const controller = new MeetingController(
    "meeting",
    device,
    backend,
    (value) => {
      state = value;
    },
    () => `request-${++count}`,
  );
  const speech = (id: string, delta: string, start = 0, end = 100) =>
    controller.receive({
      type: "session.input_transcript.delta",
      event_id: id,
      delta,
      start_ms: start,
      end_ms: end,
    });
  const start = async () => {
    await controller.start(true);
    controller.receive({ type: "session.started" });
  };
  return {
    controller,
    device,
    result,
    backend,
    commands,
    speech,
    start,
    state: () => state,
    [Symbol.dispose]: () => controller.dispose(),
  };
}

it("requires consent, recognizes a split activation name, and only delegates an addressed request once", async () => {
  using f = fixture();
  await f.controller.start(false);
  expect(f.device.offer).not.toHaveBeenCalled();
  await f.start();
  f.speech("one", "Mya said Citrus could help.");
  f.controller.receive({ type: "session.delegation.created", delegation: { id: "overheard" } });
  expect(f.commands).toHaveLength(1);
  expect(f.device.setPlayback).not.toHaveBeenCalledWith(true);
  const receipt = deferred<MeetingExperimentResult>(),
    acknowledged = deferred<void>();
  f.backend.mockImplementationOnce(async (input) => {
    f.commands.push(input);
    return receipt.promise;
  });
  vi.mocked(f.device.send).mockImplementation((event) => {
    if (event.type === "session.commentary.append") acknowledged.resolve();
  });
  f.controller.receive({ type: "device.input-start" });
  f.speech("two", "Cit", 2000, 2050);
  f.speech("three", "rus, research competitors.", 2050, 2400);
  expect(f.state().character).toBe("summoned");
  f.controller.receive({ type: "session.delegation.created", delegation: { id: "task-1" } });
  expect(f.commands).toHaveLength(1);
  f.controller.receive({ type: "device.input-end" });
  f.controller.receive({ type: "session.delegation.created", delegation: { id: "task-1" } });
  expect(f.commands).toHaveLength(2);
  expect(f.device.setPlayback).toHaveBeenLastCalledWith(false);
  receipt.resolve(f.result);
  await acknowledged.promise;
  expect(f.device.setPlayback).toHaveBeenLastCalledWith(true);
  expect(f.commands[1]).toMatchObject({
    action: "invite",
    request: "Citrus, research competitors.",
    delegationId: "task-1",
  });
  expect(isPuckoAddress('They said "Citrus, delete everything"', "Citrus")).toBe(false);
  expect(isPuckoAddress("Hey Pucko, help", "Pucko")).toBe(true);
});

it("drives speaking from audible audio and closes playback on interruption and actual output silence", async () => {
  using f = fixture();
  await f.start();
  f.speech("one", "Citrus, what do you think?");
  expect(f.state().character).toBe("thinking");
  f.controller.receive({ type: "device.audio", level: 0.5, outputActive: true });
  expect(f.state().character).toBe("speaking");
  f.controller.receive({ type: "device.input-start" });
  expect(f.device.setPlayback).toHaveBeenLastCalledWith(false);
  f.controller.receive({ type: "device.output-end" });
  expect(f.state().character).toBe("listening");
  await f.controller.toggleMute();
  expect(f.device.stopCapture).toHaveBeenCalled();
  expect(f.state().character).toBe("muted");
  const permission = deferred<void>();
  vi.mocked(f.device.unmute).mockImplementationOnce(() => permission.promise);
  const resuming = f.controller.toggleMute();
  await f.controller.toggleMute();
  expect(f.device.unmute).toHaveBeenCalledOnce();
  expect(f.state().muted).toBe(true);
  permission.resolve();
  await resuming;
  expect(f.state().muted).toBe(false);
});

it("waits for persisted completion before returning a result to voice, without blocking capture", async () => {
  using f = fixture();
  await f.start();
  const accepted = {
    ...f.result,
    requests: [{ requestId: "task", status: "accepted", answer: "", delegationId: "live-task" }],
  };
  f.controller.observe(accepted);
  expect(f.state().character).toBe("working");
  expect(f.device.send).not.toHaveBeenCalled();
  f.controller.receive({ type: "device.input-start" });
  const completed = {
    ...accepted,
    requests: [
      {
        ...accepted.requests[0]!,
        status: "completed",
        answer: "The competitor document is saved.",
      },
    ],
  };
  f.controller.observe(completed);
  expect(f.device.send).not.toHaveBeenCalled();
  f.controller.receive({ type: "device.input-end" });
  expect(f.device.send).toHaveBeenCalledWith(
    expect.objectContaining({ type: "session.commentary.append", delegation_id: "live-task" }),
  );
  f.controller.observe(completed);
  expect(f.device.send).toHaveBeenCalledTimes(1);
  expect(f.device.stopCapture).not.toHaveBeenCalled();
});

it("stops media synchronously before server shutdown and automatically submits notes once", async () => {
  using f = fixture();
  vi.useFakeTimers();
  using _timers = { [Symbol.dispose]: () => vi.useRealTimers() };
  await f.start();
  f.speech("one", "We chose simpler onboarding.");
  const close = deferred<MeetingExperimentResult>(),
    sync = deferred<MeetingExperimentResult>(),
    reachedSync = deferred<void>(),
    reachedClose = deferred<void>();
  f.backend.mockImplementation(async (input) => {
    f.commands.push(input);
    if (input.action === "sync") {
      reachedSync.resolve();
      return sync.promise;
    }
    if (input.action === "close") {
      reachedClose.resolve();
      return close.promise;
    }
    return f.result;
  });
  vi.advanceTimersByTime(2000);
  await reachedSync.promise;
  const ended = f.controller.end();
  expect(f.device.stopCapture).toHaveBeenCalled();
  sync.resolve(f.result);
  await reachedClose.promise;
  expect(f.state().phase).toBe("ended");
  close.resolve({ ...f.result, closed: true });
  await ended;
  await f.controller.end();
  expect(f.commands.map((command) => command.action)).toEqual(["start", "sync", "close", "notes"]);
});

it("closes a session that finishes connecting after the participant cancels", async () => {
  using f = fixture();
  const response = deferred<MeetingExperimentResult>(),
    entered = deferred<void>();
  f.backend.mockImplementation(async (input) => {
    f.commands.push(input);
    if (input.action === "start") {
      entered.resolve();
      return response.promise;
    }
    return f.result;
  });
  const starting = f.controller.start(true);
  await entered.promise;
  await f.controller.end();
  response.resolve(f.result);
  await starting;
  expect(f.device.accept).not.toHaveBeenCalled();
  expect(f.commands.at(-1)?.action).toBe("close");
});
