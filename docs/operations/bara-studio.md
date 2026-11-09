# Bara Studio engine setup

The T3 fork owns the web interface, environment permissions and agent connection. The
creative engine stays in [Fresh-Industries/Bara](https://github.com/Fresh-Industries/Bara)
and runs locally through its JSON CLI. Do not copy its egui application into this repo.
The current bridge was checked against commit
`9f93da6f7c9e2aaad7531df5dec5b6cbf7e5773a` with Rust 1.75.

Build `bara-cli` in a separate checkout of that revision:

```sh
cargo build --locked --release -p bara-cli
```

Desktop installers bundle and connect the engine automatically. For standalone servers,
install the executable in `<Bara base directory>/bin/bara-cli` (`bara-cli.exe` on Windows),
on the server's PATH as `bara-cli`, or set
`BARA_STUDIO_CLI` to its absolute path before starting the server. Install FFmpeg for
Motion and saved Live clip exports; it is resolved from PATH, or from the absolute
`BARA_STUDIO_FFMPEG` setting. The server does not download encoders or engine binaries.
For example, from the T3 checkout:

```sh
BARA_STUDIO_CLI=/path/to/bara-engine/target/release/bara-cli \
BARA_STUDIO_FFMPEG=/usr/bin/ffmpeg vp run dev
```

Each T3 state directory owns a `bara-studio` folder containing the native catalog,
artwork history, immutable media and Live collection. Back up the entire folder along
with the T3 state. Reopening the app retains these files. Do not edit that folder while
the app is writing; independent CLI writes do not publish T3 subscription updates.
Engine assets use their native revisions and retry receipts. T3 conversation history
and provider execution remain in the existing T3 services.

The connection needs file-read permission for inspection and both file-read/write for
edits and export. Agent writes additionally require full access. The bridge permits
managed assets and existing T3 attachment uploads, rejecting arbitrary external path
references. Account sync, platform capture settings and external destinations are not
exposed as agent-controlled operations.

Image imports currently accept PNG/JPEG up to 12 MiB and 16 megapixels, stored as canonical
PNG up to 8 MiB. Audio originals accept WAV/MP3 up to 256 MiB. Older clients and inline previews are limited to 48 MiB per export. Current clients stream
video exports through authenticated attachment URLs, up to 2 GiB total and 1,024 files.
Temporary downloads expire with the existing pending-attachment cleanup after 24 hours.
Browser recordings currently save at 512 MiB rather than continuing to grow in memory.
WHIP needs an HTTPS provider that permits browser requests; no RTMP relay is bundled.
Device capture, codecs and system-audio availability depend on the browser and OS.

Design paths support canvas handles and structured contour edits. Story characters can bind
saved top-level artwork layers to a rig; Motion applies matching pinned rigs and edits joint
keyframes. Source revisions remain native, including undo/redo. Changing a character template
does not replace existing animation instances.

## Local recording transcription

Recordings imports MP4/WebM/MOV/MKV uploads up to 256 MiB, retaining an owned original.
Transcription uses the engine's existing offline faster-whisper helper. Provision an existing
Python interpreter with `faster-whisper==1.2.1` and `av==16.0.1`, and a local CTranslate2 Whisper
model directory containing `model.bin`, `config.json`, `tokenizer.json` and `vocabulary.txt`.
The helper never downloads models or sends media to an external service. For example, a separate
virtual environment made with `python3 -m venv --copies /path/to/transcriber` preserves its
package environment when the engine resolves the executable's real path. Point the server at
that environment's absolute Python executable and the model directory:

```sh
BARA_STUDIO_TRANSCRIBE_PYTHON=/path/to/transcriber/bin/python \
BARA_STUDIO_TRANSCRIBE_MODEL=/path/to/whisper-tiny vp run dev
```

On Windows use the environment's `Scripts/python.exe`. Without settings, Bara looks for
`<base>/bin/transcriber/python` (`python.exe` on Windows) and `<base>/models/whisper-tiny`.
The desktop installer bundles the creative engine, but not Python, model weights or FFmpeg.
The verified tiny model was `Systran/faster-whisper-tiny` revision
`d90ca5fe260221311c53c58e660288d3deb8d356`.

One recording transcribes at a time; up to eight can wait. The backend owns the work after
the browser closes. Explicit Cancel stops a transcription; archiving does not. A backend
restart marks interrupted work for a manual retry and preserves the original. Transcript
edits save new immutable revisions. A contiguous range, up to 15 minutes, exports as MP4,
separate SRT captions and editable JSON. Captions are not burned in; multi-cut editing is
not supported. Store and back up the complete recordings folder with Studio state.

General 3D and standalone video/audio editors were planned in the source project; they are
not shipped engine capabilities of this bridge.
