# Pucko voice

Paid, opt-in verification of the production Pucko prompt against GPT-Live.
Synthetic speech passes through a real WebRTC connection. Results include the
actual input/output transcripts, non-silent received audio sample count, delegation
count and confirmed closure. Raw audio is not saved.

This checks selective replies and meeting context. It does **not** prove browser
speaker audibility, microphone permissions, room echo, interruption quality or
Bara task execution. Review semantic correctness against `cases.ts`; signal checks
only check that addressed questions produce audio, passive discussion stays quiet,
and research requests emit delegation. The native sink counts raw received audio;
a delegation acknowledgement can race server suppression. The controller regression
test checks that speaker playback stays closed until Bara accepts the request.

Add `--controller` to pass actual model events and native PCM activity through the
production meeting controller. The report then records `playedSamples` after its
playback gate and the requests it tried to hand off. This uses a native audio sink,
not the browser player or physical speakers. Handoffs are recorded and rejected;
the fixture never starts a Bara agent or claims real task acceptance. Local
transcript persistence and notes use fixture receipts, not a live database.

Install the optional native test adapter outside the checkout; it is not a Bara
runtime dependency:

```sh
npm install --prefix /tmp/pucko-eval-webrtc @roamhq/wrtc
cd evals
pnpm pucko-voice --out runs/pucko --webrtc-module /tmp/pucko-eval-webrtc/node_modules/@roamhq/wrtc
```

Set `OPENAI_API_KEY` privately or use the ignored root `.env` as described in the
[parent guide](../README.md). The key needs GPT-Live and speech API access.
`--case addressed` and `--samples 1` check setup. Default: three samples of each
case. `--model` defaults to `gpt-live-1`. Compare a saved run using
`--baseline runs/earlier/results.json`; use the same model and sample count.

Each sample bills one Live session lasting the input duration plus nine seconds;
synthetic TTS clips are generated once per distinct clip in a run. Consult the
OpenAI usage dashboard for the actual cost. Keep results under ignored `runs/`.
A failed signal or semantically wrong response blocks physical acceptance claims.
