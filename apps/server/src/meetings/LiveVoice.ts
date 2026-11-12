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
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { puckoInstructions } from "./puckoInstructions.ts";

const Answer = Schema.Struct({
  session: Schema.Struct({ id: Schema.String }),
  transport: Schema.Struct({ type: Schema.Literal("webrtc"), sdp: Schema.String }),
});
const isMeetingError = Schema.is(MeetingExperimentError);

export class LiveVoice extends Context.Service<
  LiveVoice,
  {
    readonly keySource: Effect.Effect<"stored" | "environment" | "missing", MeetingExperimentError>;
    readonly configure: (apiKey: string) => Effect.Effect<void, MeetingExperimentError>;
    readonly connect: (
      sdp: string,
      activationName?: string,
    ) => Effect.Effect<{ sessionId: string; sdp: string }, MeetingExperimentError>;
  }
>()("t3/meetings/LiveVoice") {}

export const layer = Layer.effect(
  LiveVoice,
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const secrets = yield* ServerSecretStore.ServerSecretStore;
    const environmentKey = yield* Config.Redacted("OPENAI_API_KEY").pipe(Config.option);
    const stored = secrets
      .get("pucko-openai-api-key")
      .pipe(
        Effect.mapError(
          () => new MeetingExperimentError({ message: "Could not read Pucko's voice credential." }),
        ),
      );
    const keySource = stored.pipe(
      Effect.map((key) =>
        Option.isSome(key)
          ? ("stored" as const)
          : Option.isSome(environmentKey)
            ? ("environment" as const)
            : ("missing" as const),
      ),
    );
    return LiveVoice.of({
      keySource,
      configure: Effect.fn("LiveVoice.configure")(function* (apiKey) {
        if (apiKey && !/^sk-[a-zA-Z0-9_-]+$/.test(apiKey))
          return yield* new MeetingExperimentError({ message: "Enter a valid OpenAI API key." });
        yield* (
          apiKey
            ? secrets.set("pucko-openai-api-key", new TextEncoder().encode(apiKey))
            : secrets.remove("pucko-openai-api-key")
        ).pipe(
          Effect.mapError(
            () =>
              new MeetingExperimentError({ message: "Could not save Pucko's voice credential." }),
          ),
        );
      }),
      connect: Effect.fn("LiveVoice.connect")(
        function* (sdp, activationName = "Citrus") {
          const saved = yield* stored;
          const key = Option.isSome(saved)
            ? new TextDecoder().decode(saved.value)
            : Option.isSome(environmentKey)
              ? Redacted.value(environmentKey.value)
              : "";
          if (!key)
            return yield* new MeetingExperimentError({
              message:
                "Add an OpenAI key in Pucko settings on this server before starting a meeting.",
            });
          const response = yield* client.execute(
            HttpClientRequest.post("https://api.openai.com/v1/live/sessions").pipe(
              HttpClientRequest.setHeader("Authorization", `Bearer ${key}`),
              HttpClientRequest.bodyJsonUnsafe({
                session: {
                  model: "gpt-live-1",
                  store: false,
                  delegation: { type: "client", acknowledgement_delay_ms: 800 },
                  instructions: puckoInstructions(activationName),
                },
                transport: { type: "webrtc", sdp },
              }),
            ),
          );
          if (response.status !== 201)
            return yield* new MeetingExperimentError({
              message: `GPT-Live session creation failed (HTTP ${response.status}). Check the key and GPT-Live project access in Pucko settings.`,
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
                  "GPT-Live connection failed or returned an unexpected response. Check the connection diagnostics and retry.",
              }),
        ),
      ),
    });
  }),
);
