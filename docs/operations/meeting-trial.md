# Desktop meeting feasibility trial

This opt-in experiment uses GPT-Live client delegation for voice and the existing
Bara Work conversation for reasoning, tools, permissions and asynchronous workers.
It does not introduce a meeting database, task scheduler, or a Meetings destination.
Do not expand it until a real two-person meeting has been evaluated.

## Run the trial

Set `BARA_MEETING_EXPERIMENT=true` and `OPENAI_API_KEY` in the **server's** environment,
then restart the server. The key needs GPT-Live project access; a Codex subscription
does not provide that API access. Keep the key out of chat and source control.
For isolated development, use `vp run dev --home-dir /workspace/scratch/bara-meeting-trial --no-seed`.
The server data directory must be outside a Git checkout for personal Work.

In desktop Bara, create a **new, empty local Work session**. Choose an existing
coordinator, project or Personal Work, and the working model/access level using
the usual controls. Open **Meeting trial** in its header. The trial is also
available in the development web renderer for verification, but is hidden in
production web and has no native mobile entry point.

1. Acknowledge every participant's consent, then start. The microphone indicator
   identifies capture and transmission to OpenAI. Discuss the topic normally.
2. Say “Citrus, what do you think about our strategy?” Use recent speech, correct
   the request, and choose **Send reviewed request**. Background discussion alone
   never submits work. The transcript can contain incomplete fragments and errors.
3. Refresh confirmed status to read the working agent's answer. To hear it through
   GPT-Live, choose **Prepare voice preview**, wait for the preview text, then
   **Finish voice preview**. Review the generated words before explicitly playing
   the local clip. Never approve an incorrect or unrelated preview.
4. Ask “Citrus, research these competitors and make a document,” review the precise
   assignment, and send it. Delegation uses the agent's existing `delegate_task`
   asynchronous path. Existing access restrictions and approval requests apply;
   the trial cannot grant permissions or approve requests on your behalf.
5. Keep talking while the worker runs. Send reviewed status questions or corrections
   through the coordinator. Use the actual child Work conversation for pending
   approvals and results. Refresh shows persisted task states; an accepted request
   is not evidence that a provider has started or a deliverable exists.
6. **Mute and end capture** stops the local microphone immediately. Then choose
   **Prepare notes in Work**. Refresh for the result, which includes decisions,
   action items, uncertainties and confirmed work links. Save the result to Library
   using the usual Work controls. Authorized background work continues after ending
   or closing the trial.

Closing the dialog, navigating away, losing the voice connection or the host
connection, or losing environment permission stops local capture. End does not
wait for the backend to acknowledge shutdown. The voice connection remains briefly
for finalization; without `session.closed`, final voice usage is unconfirmed.
Restart by creating a new trial; this slice does not recover live capture after
reload or server restart. Stop the trial before closing the laptop lid.

## Privacy and device boundaries

Audio is sent directly to OpenAI over WebRTC, with `store: false`. This disables
optional stored Live recordings; it does not assert zero provider retention.
Unsubmitted transcript fragments stay in client memory. A reviewed request sends
its current transcript context to the chosen Work conversation and provider; that
context becomes ordinary durable conversation history. Notes submission saves the
final context there too. No personal relationship conversation is copied to the
voice model. Work still receives the coordinator's normally authorized scoped
memory, skills and optional relationship recall; review that configuration before
including another person in the meeting.

Unsolicited remote audio has no connected playback destination. An explicit preview
records remote output **in client memory**, bounded to 30 seconds and 8 MiB, and
only plays after local approval. Stopping or closing releases capture, previews
and object URLs. Browser permissions and the OS microphone indicator remain useful
independent checks. No voice event, including `session.delegation.created`, can
submit a command or grant approval.

The `MeetingDevice` interface separates offer/answer transport, capture shutdown,
preview capture and playback from the portable meeting controller. A Raspberry Pi
client can implement that interface and use the same authenticated Bara command
contract. Work intelligence stays in Bara's existing runtime. Hardware must retain
a synchronous local capture stop and explicit playback authorization; server-side
mute alone is insufficient. This experiment deliberately has no device provisioning
or hardware service.

## API assumptions and unresolved behavior

The integration follows the current official [WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc),
[client delegation](https://developers.openai.com/api/docs/guides/live-delegation),
and [session](https://developers.openai.com/api/docs/guides/live-conversations) guides:

- Session creation is `POST /v1/live/sessions` with JSON `session` and
  `transport: { type: "webrtc", sdp }`; success must contain the original opaque
  `session.id` and `transport.sdp`. It does not use the older Realtime endpoint,
  ephemeral-key flow or `response.create` tool loop.
- Wait for `session.started`. Transcript events are `session.input_transcript.delta`
  and `session.output_transcript.delta`, with `event_id`, `delta`, `start_ms` and
  `end_ms`. Deltas have no completed conversational-turn marker. They are
  deduplicated; timestamps are retained. Missing/changed event shapes need an
  adapter update, not a permissive fallback that starts work.
- Client delegation events have no task text. This slice deliberately uses
  reviewed transcript requests instead of interpreting those events as commands.
- GPT-Live has no documented output completion marker or reliable per-answer
  playback correlation in this flow. The preview is bounded and manually stopped;
  its captions can include delayed or unrelated model output. Review before play.
  Direct automatic playback and automatic name-triggered execution are unvalidated
  and disabled. Prompting the model to be quiet is not the enforcement boundary.
- There is no human-speaker attribution. Multiple participants share one stream;
  the notes must not guess identities or owners. Overlapping speech, room echo,
  transcript latency and barge-in need physical testing. During approved playback,
  incoming human transcript deltas stop the player; transcription delay means this
  is not an instantaneous acoustic interruption guarantee. Stop playback is local.
- `session.commentary.append` accepts at most 500 tokens. Preview source text is
  bounded, but actual acceptance and paraphrasing need live validation. Rejections
  stop capture rather than opening playback or running alternative work.
- The primary data channel owns events here; no sideband or new server WebSocket
  infrastructure is added. Connection loss ends capture; there is no replay-based
  recovery. GPT-Live duration charges include passive listening and microphone mute.

These are documentation-based assumptions, not evidence of successful live API
behavior. No GPT-Live project key was available during offline validation. The
user elected to perform the live meeting test. Record actual model/API errors,
event types, latency and behavior without keys, audio or private transcript text
before changing the gates or expanding scope.

## Two-person acceptance test

Use synthetic business details and a harmless research/document task first.
Verify the following with the OS microphone indicator, Work history and actual
deliverables, not only the trial's labels:

- Discuss Citrus in the third person, quote requests, and speak over each other.
  Expect no audible response, provider turn, or worker until a request is reviewed
  and submitted. Even a Live delegation event must not launch work.
- Ask a question that requires earlier discussion. Check that the selected provider
  answers from context. Repeat with Codex and Claude; voice must not change that
  selection. Verify the preview matches the confirmed answer before playback.
- Start one async task, keep talking, ask for status, then correct its brief. Verify
  an actual child conversation, correct permissions, no duplicate task on retries,
  and a saved document before describing it as finished.
- End during provider execution and during connection startup. Expect local capture
  to stop immediately while existing work continues. Test device removal, dialog
  close/navigation, host disconnection, and a rejected permission as well.
- Prepare notes. Check explicit decisions, missing attribution, action items and
  ongoing/failed/completed work against what actually happened. Verify that the
  canonical personal conversation was neither sent to OpenAI nor overwritten.

Record pass/fail and observed delays for each item. A failed silence, execution,
privacy or local-shutdown check blocks further scope. Hands-free invitations and
automatic speech remain outside the proven experience until those gates have
been replaced with validated controls.
