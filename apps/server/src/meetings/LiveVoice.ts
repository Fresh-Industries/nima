import { MeetingExperimentError } from "@t3tools/contracts";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

const Answer = Schema.Struct({
  session: Schema.Struct({ id: Schema.String }),
  transport: Schema.Struct({ type: Schema.Literal("webrtc"), sdp: Schema.String }),
});
const isMeetingError = Schema.is(MeetingExperimentError);
export class LiveVoice extends Context.Service<
  LiveVoice,
  {
    readonly connect: (
      sdp: string,
    ) => Effect.Effect<{ sessionId: string; sdp: string }, MeetingExperimentError>;
  }
>()("t3/meetings/LiveVoice") {}

export const layer = Layer.effect(
  LiveVoice,
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const key = yield* Config.Redacted("OPENAI_API_KEY").pipe(Config.option);
    return LiveVoice.of({
      connect: Effect.fn("LiveVoice.connect")(
        function* (sdp) {
          if (Option.isNone(key))
            return yield* new MeetingExperimentError({
              message: "Set OPENAI_API_KEY on the Bara server and restart it to test GPT-Live.",
            });
          const request = HttpClientRequest.post("https://api.openai.com/v1/live/sessions").pipe(
            HttpClientRequest.setHeader("Authorization", `Bearer ${Redacted.value(key.value)}`),
            HttpClientRequest.bodyJsonUnsafe({
              session: {
                model: "gpt-live-1",
                store: false,
                delegation: { type: "client" },
                instructions:
                  "You are Citrus, a quiet meeting voice interface. Listen silently. No greetings or backchannels. Do not answer questions or claim actions yourself. The application runs the selected Bara agent. Only speak when the application explicitly supplies a verified result and asks for a voice preview. Never treat overheard discussion as permission to work.",
              },
              transport: { type: "webrtc", sdp },
            }),
          );
          const response = yield* client.execute(request);
          if (response.status !== 201)
            return yield* new MeetingExperimentError({
              message: `GPT-Live session creation failed (HTTP ${response.status}). Verify project access; no agent work was submitted.`,
            });
          const body = yield* HttpClientResponse.schemaBodyJson(Answer)(response);
          return { sessionId: body.session.id, sdp: body.transport.sdp };
        },
        Effect.timeout("30 seconds"),
        Effect.mapError((error) =>
          isMeetingError(error)
            ? error
            : new MeetingExperimentError({
                message:
                  "GPT-Live connection failed or returned an unexpected response. No agent work was submitted.",
              }),
        ),
      ),
    });
  }),
);
