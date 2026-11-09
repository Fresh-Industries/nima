# Bara releases

Bara desktop updates come from `Fresh-Industries/nima` GitHub releases. They never
use the upstream T3 feed. Source pushes alone do not update installed apps: each
release needs its installer, matching blockmap, and generated `latest.yml`.

On a Windows build machine, update the four release package versions with
`node scripts/update-release-package-versions.ts <version>`, run the scoped checks,
and commit the source. Build with the existing desktop packaging command in
[the desktop guide](../bara/desktop.md), setting `BARA_STUDIO_ENGINE_BINARY` to the
separately built Windows Studio CLI. Keep that Rust source in its own repository.
The initial release also provides `bara-studio-engine-windows-x64.exe`; verify it
against the release's `SHA256SUMS` before reusing it for packaging.

Create and push a `v<version>` tag on the exact source commit. Create a draft
GitHub release for that tag and upload the generated `Bara-<version>-x64.exe`,
its `.blockmap`, `latest.yml`, and `SHA256SUMS`. Validate the manifest's version,
asset name, size, and SHA-512 against the uploaded installer, then publish the
release as the latest release. Never rename the installer after generating the
manifest. Keep old releases available for differential downloads and rollback.

Use `gh release create ... --draft --verify-tag --notes-file ...` and
`gh release upload ...` to prepare a release. Publish it with
`gh release edit v<version> --draft=false --latest` after validation. The existing
upstream release workflow is restricted to T3's repository and does not publish
Bara. Packaging defaults to Bara's feed; `BARA_DESKTOP_UPDATE_REPOSITORY` can
explicitly select another fork, and an empty value disables feed generation.

Bara versions are independent of the upstream SSH archive version. The desktop
currently pins the compatible T3 SSH runtime in
[DesktopSshCliRunner.ts](../../apps/desktop/src/ssh/DesktopSshCliRunner.ts), so a
Bara version bump cannot request a nonexistent upstream archive. This does not
upgrade a plain T3 remote into a Bara server.

Windows release builds are currently unsigned. Do not disable updater checks or
change the app ID or data paths to work around installation problems. A future
signing certificate must keep the same application identity and update feed.
