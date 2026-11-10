# Bara releases

Bara desktop updates come from `Fresh-Industries/nima` GitHub releases. They never
use the upstream T3 feed. Source pushes alone do not update installed apps: each
release needs its installer, matching blockmap, and generated `latest.yml`.

On a Windows build machine, update the four release package versions with
`node scripts/update-release-package-versions.ts <version>`, run the scoped checks,
and commit the source. Build with the existing desktop packaging command in
[the desktop guide](../bara/desktop.md), setting `BARA_STUDIO_ENGINE_BINARY` to the
separately built Windows Studio CLI. Keep that Rust source in its own repository.
The initial 0.1.8 release also provides Windows and Linux x64 Studio engine assets;
verify them against its `SHA256SUMS` before reusing them for packaging.

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

Each release must also include `t3-<version>-linux-x64.tar.gz` for SSH setup.
Build it with the existing CLI executable and archive scripts. Set
`BARA_STUDIO_ENGINE_BINARY` to the Linux x64 Studio CLI when assembling that archive.
The server discovers its engine beside the packaged executable; it does not depend
on a remote shell's environment variables. Include the archive and both reusable
engine assets in `SHA256SUMS`. Bara's CLI update feed also points to this fork.

The first 0.1.8 release bootstraps those verified engine assets through a local build.
Subsequent version tags run
[the Bara release workflow](../../.github/workflows/release-bara-windows.yml), which
builds Windows and Linux, verifies uploaded checksums, then publishes. It reuses the
separately owned engines from 0.1.8 without checking private Rust source into this
repository. Publish both platforms together: a desktop version must never request
an SSH archive absent from its release.

Windows release builds are currently unsigned. Do not disable updater checks or
change the app ID or data paths to work around installation problems. A future
signing certificate must keep the same application identity and update feed.
