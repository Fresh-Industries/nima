import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as LiveVoice from "./LiveVoice.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
const secrets = Layer.mock(ServerSecretStore.ServerSecretStore)({ get: () => Effect.succeedNone });

it.effect(
  "uses client delegation without exposing private context, model choices or credentials to the client",
  () => {
    const decode = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
    const client = HttpClient.make((request) =>
      Effect.sync(() => {
        assert.equal(request.url, "https://api.openai.com/v1/live/sessions");
        assert.equal(request.headers.authorization, "Bearer test-secret");
        assert.equal(request.body._tag, "Uint8Array");
        if (request.body._tag !== "Uint8Array") throw new Error("Expected JSON body");
        const body = decode(new TextDecoder().decode(request.body.body));
        const instructions = (body as { session: { instructions: string } }).session.instructions;
        assert.isNotEmpty(instructions);
        assert.containsAllKeys(body, ["session", "transport"]);
        assert.deepInclude(body, { transport: { type: "webrtc", sdp: "offer" } });
        assert.deepInclude(body, {
          session: {
            model: "gpt-live-1",
            store: false,
            delegation: { type: "client", acknowledgement_delay_ms: 800 },
            instructions: (body as { session: { instructions: string } }).session.instructions,
          },
        });
        return HttpClientResponse.fromWeb(
          request,
          Response.json(
            {
              session: { id: "live_original-prefix" },
              transport: { type: "webrtc", sdp: "answer" },
            },
            { status: 201 },
          ),
        );
      }),
    );
    return Effect.gen(function* () {
      const voice = yield* LiveVoice.LiveVoice;
      assert.deepEqual(yield* voice.connect("offer"), {
        sessionId: "live_original-prefix",
        sdp: "answer",
      });
    }).pipe(
      Effect.provide(
        LiveVoice.layer.pipe(
          Layer.provide(secrets),
          Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
          Layer.provide(
            ConfigProvider.layer(ConfigProvider.fromUnknown({ OPENAI_API_KEY: "test-secret" })),
          ),
        ),
      ),
    );
  },
);

it.effect(
  "reports API rejection and malformed responses without reflecting sensitive bodies",
  () => {
    let malformed = false;
    const client = HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          Response.json(
            { error: "test-secret private provider data" },
            { status: malformed ? 201 : 403 },
          ),
        ),
      ),
    );
    return Effect.gen(function* () {
      const voice = yield* LiveVoice.LiveVoice;
      const rejected = yield* voice.connect("offer").pipe(Effect.flip);
      assert.include(rejected.message, "HTTP 403");
      assert.notInclude(rejected.message, "test-secret");
      malformed = true;
      assert.include(
        (yield* voice.connect("offer").pipe(Effect.flip)).message,
        "unexpected response",
      );
    }).pipe(
      Effect.provide(
        LiveVoice.layer.pipe(
          Layer.provide(secrets),
          Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
          Layer.provide(
            ConfigProvider.layer(ConfigProvider.fromUnknown({ OPENAI_API_KEY: "test-secret" })),
          ),
        ),
      ),
    );
  },
);

it.effect(
  "updates and removes the server credential without a restart, preserving the environment fallback",
  () => {
    let saved: Option.Option<Uint8Array> = Option.none();
    const keys: string[] = [];
    const secretStore = Layer.mock(ServerSecretStore.ServerSecretStore)({
      get: () => Effect.sync(() => saved),
      set: (_name, value) =>
        Effect.sync(() => {
          saved = Option.some(value);
        }),
      remove: () =>
        Effect.sync(() => {
          saved = Option.none();
        }),
    });
    const client = HttpClient.make((request) =>
      Effect.sync(() => {
        keys.push(request.headers.authorization!);
        return HttpClientResponse.fromWeb(
          request,
          Response.json(
            { session: { id: "live" }, transport: { type: "webrtc", sdp: "answer" } },
            { status: 201 },
          ),
        );
      }),
    );
    return Effect.gen(function* () {
      const voice = yield* LiveVoice.LiveVoice;
      assert.equal(yield* voice.keySource, "environment");
      yield* voice.connect("offer", "Pucko");
      yield* voice.configure("sk-replacement");
      assert.equal(yield* voice.keySource, "stored");
      yield* voice.connect("offer");
      yield* voice.configure("bad key").pipe(Effect.flip);
      assert.equal(yield* voice.keySource, "stored");
      yield* voice.configure("");
      assert.equal(yield* voice.keySource, "environment");
      yield* voice.connect("offer");
      assert.deepEqual(keys, ["Bearer fallback", "Bearer sk-replacement", "Bearer fallback"]);
    }).pipe(
      Effect.provide(
        LiveVoice.layer.pipe(
          Layer.provide(secretStore),
          Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
          Layer.provide(
            ConfigProvider.layer(ConfigProvider.fromUnknown({ OPENAI_API_KEY: "fallback" })),
          ),
        ),
      ),
    );
  },
);
