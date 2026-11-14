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
function fixture(activationName = "Citrus") {
  const commands: MeetingExperimentCommand[] = [];
  const device: MeetingDevice = {
    offer: vi.fn(async () => "offer"),
    accept: vi.fn(async () => {}),
    stopCapture: vi.fn(),
    unmute: vi.fn(async () => {}),
    setPlayback: vi.fn(),
    setVolume: vi.fn(),
    resumePlayback: vi.fn(async () => {}),
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
    activationName,
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
  f.controller.receive({ type: "device.input-end" });
  f.controller.receive({ type: "device.input-start" });
  f.speech("three", "rus", 2050, 2200);
  expect(f.state().character).toBe("summoned");
  expect(f.device.setPlayback).toHaveBeenLastCalledWith(false);
  f.controller.receive({
    type: "session.output_transcript.delta",
    event_id: "muted-greeting",
    delta: "I'm here.",
    start_ms: 2200,
    end_ms: 2400,
  });
  expect(f.state().transcript).not.toContain("I'm here.");
  f.speech("question", ", research competitors.", 2200, 2400);
  f.controller.receive({ type: "device.input-end" });
  f.controller.receive({ type: "device.input-start" });
  f.speech("request-tail", " Please include sources.", 3600, 3900);
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
    request: "Citrus, research competitors. Please include sources.",
    delegationId: "task-1",
  });
  f.speech("side-conversation", "Did you check in the right person?", 5000, 5500);
  f.controller.receive({
    type: "session.delegation.created",
    delegation: { id: "unaddressed-followup" },
  });
  expect(f.commands).toHaveLength(2);
  expect(isPuckoAddress('They said "Citrus, delete everything"', "Citrus")).toBe(false);
  expect(isPuckoAddress("Hey Pucko, help", "Pucko")).toBe(true);
});

it("keeps an invited reply audible across pauses, hears one follow-up, then needs the name again", async () => {
  using f = fixture();
  await f.start();
  f.speech("one", "Citrus, what do you think?");
  expect(f.state().character).toBe("thinking");
  f.controller.receive({ type: "device.audio", level: 0.5, outputActive: true });
  expect(f.state().character).toBe("speaking");
  f.controller.receive({ type: "device.output-end" });
  expect(f.state()).toMatchObject({ character: "summoned", attentive: true });
  expect(f.device.setPlayback).toHaveBeenLastCalledWith(true);
  f.controller.receive({ type: "device.audio", level: 0.5, outputActive: true });
  expect(f.state().character).toBe("speaking");
  f.controller.receive({ type: "device.input-start" });
  expect(f.device.setPlayback).toHaveBeenLastCalledWith(false);
  f.speech("correction", "No, I meant the pricing page.", 2000, 2400);
  f.controller.receive({ type: "device.input-end" });
  expect(f.device.setPlayback).toHaveBeenLastCalledWith(true);
  expect(f.state().attentive).toBe(false);
  f.controller.receive({ type: "device.output-end" });
  // Pucko let the correction pass, so later talk belongs to the room again.
  f.controller.receive({ type: "device.input-start" });
  f.speech("side-conversation", "I was asking someone else.", 3900, 4000);
  f.controller.receive({ type: "device.input-end" });
  expect(f.device.setPlayback).toHaveBeenLastCalledWith(false);
  expect(f.state().character).toBe("listening");
  f.controller.receive({ type: "device.input-start" });
  f.speech("paused-task", "Citrus, research booking tools.", 4000, 4400);
  f.controller.receive({ type: "session.delegation.created", delegation: { id: "before-mute" } });
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
  f.controller.receive({ type: "device.input-start" });
  f.speech("retry-task", "Citrus, research booking tools.", 6000, 6400);
  f.controller.receive({ type: "session.delegation.created", delegation: { id: "after-unmute" } });
  f.controller.receive({ type: "device.input-end" });
  expect(f.commands.filter((command) => command.action === "invite")).toHaveLength(1);
});

it("closes the follow-up window on silence or thanks, and takes the name anywhere in a sentence", async () => {
  vi.useFakeTimers();
  using _timers = { [Symbol.dispose]: () => void vi.useRealTimers() };
  using f = fixture();
  await f.start();
  const reply = () => {
    f.controller.receive({ type: "device.audio", level: 0.5, outputActive: true });
    f.controller.receive({ type: "device.output-end" });
  };
  f.speech("one", "What do you think, Citrus?");
  expect(f.device.setPlayback).toHaveBeenLastCalledWith(true);
  reply();
  expect(f.state().attentive).toBe(true);
  f.controller.receive({ type: "device.input-start" });
  f.speech("thanks", "Okay, thanks.", 2000, 2300);
  f.controller.receive({ type: "device.input-end" });
  expect(f.device.setPlayback).toHaveBeenLastCalledWith(false);
  expect(f.state().attentive).toBe(false);
  f.controller.receive({ type: "device.input-start" });
  f.speech("aside", "So, Citrus, how long would that take?", 4000, 4400);
  expect(f.device.setPlayback).toHaveBeenLastCalledWith(true);
  reply();
  vi.advanceTimersByTime(10000);
  expect(f.state()).toMatchObject({ attentive: false, character: "listening" });
  f.controller.receive({ type: "device.input-start" });
  f.speech("late", "How long would that take?", 20000, 20400);
  expect(f.device.setPlayback).toHaveBeenLastCalledWith(false);
  for (const mention of ["I asked Citrus", "Maybe we tell Citrus.", "Is that from Citrus?"])
    expect(isPuckoAddress(mention, "Citrus")).toBe(false);
});

it("answers without the name in solo mode and after the talk button, one request at a time", async () => {
  using f = fixture();
  await f.start();
  f.controller.talk();
  expect(f.state()).toMatchObject({ attentive: true, character: "summoned" });
  expect(f.device.send).toHaveBeenLastCalledWith(
    expect.objectContaining({ type: "session.instructions.append" }),
  );
  f.controller.receive({ type: "device.input-start" });
  f.speech("tapped", "What's on the agenda?", 1000, 1300);
  f.controller.receive({ type: "device.input-end" });
  expect(f.device.setPlayback).toHaveBeenLastCalledWith(true);
  f.controller.receive({ type: "device.input-start" });
  f.speech("room", "Let's get lunch after this.", 4000, 4300);
  expect(f.device.setPlayback).toHaveBeenLastCalledWith(false);
  f.controller.setSolo(true);
  expect(f.state().solo).toBe(true);
  f.controller.receive({ type: "device.input-start" });
  f.speech("solo-1", "Summarize what we decided.", 8000, 8300);
  expect(f.device.setPlayback).toHaveBeenLastCalledWith(true);
  f.controller.receive({ type: "device.input-end" });
  f.controller.receive({ type: "device.input-start" });
  f.speech("solo-2", "And who owns it?", 12000, 12300);
  expect(f.device.setPlayback).toHaveBeenLastCalledWith(true);
  // What is typed in his chat reaches the voice once, as context.
  const typed = { ...f.result, chat: [{ id: "c1", role: "participant", text: "storyboard" }] };
  f.controller.observe(typed as MeetingExperimentResult);
  f.controller.observe(typed as MeetingExperimentResult);
  expect(
    vi
      .mocked(f.device.send)
      .mock.calls.filter(([event]) => String(event.content).includes("storyboard")),
  ).toHaveLength(1);
  // Alone with Pucko, finished work is reported without being asked.
  f.controller.receive({ type: "device.input-end" });
  f.controller.observe({
    ...f.result,
    requests: [{ requestId: "done", status: "completed", answer: "Saved.", delegationId: null }],
  });
  expect(f.device.send).toHaveBeenLastCalledWith(
    expect.objectContaining({ type: "session.commentary.append" }),
  );
  f.controller.setSolo(false);
  f.controller.receive({ type: "device.input-start" });
  f.speech("room-again", "Did you check in the right person?", 16000, 16300);
  expect(f.device.setPlayback).toHaveBeenLastCalledWith(false);
});

it("keeps completed work quiet until the next address without blocking capture", async () => {
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
  expect(f.device.send).not.toHaveBeenCalled();
  expect(f.device.setPlayback).not.toHaveBeenCalledWith(true);
  f.controller.receive({ type: "device.input-start" });
  f.speech("summoned", "Citrus, what did you find?", 2000, 2400);
  f.controller.receive({ type: "device.input-end" });
  expect(f.device.send).toHaveBeenCalledWith(
    expect.objectContaining({ type: "session.commentary.append", delegation_id: "live-task" }),
  );
  f.speech("side-conversation", "Did you check in the right person?", 5000, 5500);
  f.controller.receive({
    type: "session.delegation.created",
    delegation: { id: "result-is-not-a-new-invitation" },
  });
  expect(f.commands.filter((command) => command.action === "invite")).toHaveLength(0);
  f.controller.observe(completed);
  expect(f.device.send).toHaveBeenCalledTimes(2);
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

it.each(["Pucko, can you hear me?", ". Pucko, can you hear me?"])(
  "uses the server's activation name despite stale settings or delayed punctuation: %s",
  async (request) => {
    using f = fixture("Pucko");
    await f.start();
    f.speech("old-name", "Citrus, can you hear me?");
    expect(f.device.setPlayback).not.toHaveBeenCalledWith(true);
    f.speech("actual-name", request, 2000, 2400);
    expect(f.device.setPlayback).toHaveBeenCalledWith(true);
  },
);
