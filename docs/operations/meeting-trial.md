# Pucko voice verification

Pucko is a standalone app in Bara's tool dock and account menu. It uses GPT-Live
for realtime conversation and the existing Work runtime for tools and notes.
There is no manual Work session prerequisite.

## Setup

Open **Pucko → Settings**, choose the Bara server that will own the meeting and
save an OpenAI project key with GPT-Live access. The credential stays in that
server's private secret store. A saved key overrides `OPENAI_API_KEY`; removing
it restores that environment fallback. No restart or experimental flag is needed.
A Codex subscription does not supply GPT-Live API access. An installed Windows
server has its own settings; a Linux checkout's `.env.local` does not configure it.

Choose an optional project and coordinator to reuse their existing provider,
tools and permissions. Personal Work is the default. Voice can connect before
an agent provider is configured; a task or notes request will report that problem.

For isolated development, run `vp run dev --home-dir /tmp/bara-pucko-dev --no-seed`.
Personal Work requires server data outside a Git checkout. Never use the live
T3 home for tests.

## Meeting behavior

Start Meeting requires everyone's consent. The app streams microphone audio to
OpenAI and saves transcript text and structured notes to the selected server.
Bara does not record raw audio. `store: false` disables optional stored Live
recordings; it does not assert zero provider retention.

The activation name defaults to **Citrus** and is configurable in settings.
Address Pucko at the beginning of a request. Ordinary questions use the meeting's
voice context. Research and tool requests go through the selected agent with
existing approval restrictions. A wake name grants no additional permissions.

Mute stops local microphone tracks. Unmute reacquires capture. End stops capture
immediately, finalizes the voice connection and requests notes; authorized agent
work continues. Moving between apps keeps a meeting active and shows a microphone
indicator with an End action. Reload, window shutdown, connection loss or revoked
permissions stops capture. A server restart marks unfinished meetings interrupted.
Meeting history and retrying notes are available inside Pucko. Summaries also save
to Library through the existing Pages service.

Web and desktop share the app. Remote web microphone access requires HTTPS or
localhost. Native mobile has no Pucko screen yet.

## Protocol constraints

The integration follows the official [WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc),
[delegation](https://developers.openai.com/api/docs/guides/live-delegation) and
[Live session](https://developers.openai.com/api/docs/guides/live-conversations) guides.

- Creation uses `POST /v1/live/sessions`, model `gpt-live-1`, and the `oai-events`
  data channel. Listening begins only after `session.started`.
- Transcript deltas have no completed-turn marker. Local audio activity and
  transcript timing bound requests; real room conditions need testing.
- Delegation events have no task text. The bridge uses the addressed transcript
  and current meeting context, suppresses unconfirmed acknowledgement, and sends
  stable request IDs through the existing orchestration receipt path.
- No per-answer output completion marker is documented. Speaker playback is gated
  by an addressed invitation; local audio activity detects output silence and
  interruption. Prompt instructions also request selective replies. This does not
  provide human-speaker attribution or an acoustic wake-word guarantee.
- Outgoing audio levels drive the mouth. Tasks and summaries use persisted agent
  states. Text/audio frames are bounded and audio never passes through Bara RPC.
- `session.commentary.append` receives bounded confirmed results. Background
  completion notices wait for a quiet interval; they do not stop microphone capture.
- Capture stops locally before waiting for `session.closed`. Missing confirmation
  leaves final session usage unconfirmed. The app reports this explicitly.

## Physical acceptance test

Use synthetic business details and a harmless research task. Automated media
fixtures prove lifecycle handling, not speaker audibility or recognition accuracy.
Record actual pass/fail and provider errors without keys or private transcripts.

1. Open Pucko directly from the dock. Start with consent and grant microphone access.
   Verify the OS microphone indicator and `session.started` in developer diagnostics.
2. Discuss a decision without addressing Pucko. Expect silence. Mention Citrus in
   the third person and quote a request; expect no worker or audible response.
3. Say “Citrus, what do you think?” Hear a short answer that uses preceding context.
   Interrupt the reply; verify immediate local silence and a sensible continuation.
4. Ask for competitor research. Verify an actual Bara task, correct project and
   provider, visible required approvals and a real result. Keep discussing while
   it runs. Check one completion notification and no duplicate task on retries.
5. Mute, unmute, change volume, navigate to another app and return. Check actual
   capture and playback, including a disconnected microphone and network loss.
6. End during startup and during task execution. Capture must stop immediately;
   existing work continues. Confirm notes, explicit decisions, action items with
   only stated owners and unresolved questions. Restart Bara and read the history.

A successful mock or build is not a completed physical acceptance test. The
prototype needs this pass on Windows Bara on Zeus before release readiness is claimed.
