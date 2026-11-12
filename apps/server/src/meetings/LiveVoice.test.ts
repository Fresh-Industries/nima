import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as LiveVoice from "./LiveVoice.ts";

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
        assert.containsAllKeys(body, ["session", "transport"]);
        assert.deepInclude(body, { transport: { type: "webrtc", sdp: "offer" } });
        assert.deepInclude(body, {
          session: {
            model: "gpt-live-1",
            store: false,
            delegation: { type: "client" },
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
          Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
          Layer.provide(
            ConfigProvider.layer(ConfigProvider.fromUnknown({ OPENAI_API_KEY: "test-secret" })),
          ),
        ),
      ),
    );
  },
);
