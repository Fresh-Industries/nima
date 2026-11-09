# Bara desktop

Install the Windows x64 Bara installer and open Bara from the Start menu. The app
starts its bundled server locally; a cloud workspace or tunnel is not needed for
local use. In Settings → Providers, install Codex if needed and sign into your
account. Internet access is still needed for hosted AI providers.

Bara stores conversations, assistant memory, notes and settings in
`%USERPROFILE%\.bara\userdata`. Its browser profile lives in `%APPDATA%\bara`.
Development uses separate profiles. `BARA_HOME` can select a different data folder;
an ambient `T3CODE_HOME` does not select Bara's desktop storage. Existing T3 profiles
and credentials are not imported automatically.

The beta installer is unsigned. Windows may show an unknown-publisher warning.
Install Bara 0.1.7 or newer once from the [Bara releases page](https://github.com/Fresh-Industries/nima/releases).
Earlier local builds lack a native update feed. After that, Settings → About → **Check for Updates**
can download and install newer published Bara releases. It checks this fork's GitHub releases,
independently of T3's releases. Downloads and installation remain explicit actions.
The live web app checks its served build and offers a reload when a newer build is available.

Your cloud preview remains a separate environment. Pair with it from Connections
to access its existing conversations; this does not copy them to the local server.
The installer uses native Windows providers and does not bundle a WSL runtime.
Studio's Rust command-line engine is bundled and connected automatically. Video
exports still require FFmpeg on your PATH.

## Building

From this checkout on a Windows build machine with the existing
[installer prerequisites](../operations/development.md#windows-installer-prerequisites):

```powershell
vp i
$env:BARA_STUDIO_ENGINE_BINARY = "C:\path\to\Bara\target\release\bara-cli.exe"
vp run dist:desktop:win:x64
```

The installer is written to `release/Bara-<version>-x64.exe`.
Build `bara-cli` in the separate Rust checkout first; its source and native UI
remain separate from this application. Packaging fails if the engine is missing.
For development, use `vp run dev:desktop`. Keep development state separate from
your normal workspace with `--home-dir` or `BARA_HOME`.

Release publishing is described in [Bara releases](../operations/bara-releases.md).
