import { useState } from "react";
import { compareSemverVersions } from "@t3tools/shared/semver";
import { APP_VERSION, DESKTOP_DOWNLOAD_URL } from "../branding";
import { useDesktopUpdateState } from "../state/desktopUpdate";
import { usePrimaryManagedPolicy } from "../state/managedPolicy";
import { managedUpdatesDenial } from "@t3tools/contracts";
import { ensureLocalApi } from "../localApi";
import { Button } from "../components/ui/button";
import { SettingsRow } from "../components/settings/settingsLayout";
import { AboutVersionTitle } from "../components/settings/AboutVersionTitle";
import {
  getDesktopUpdateInstallConfirmationMessage,
  resolveDesktopUpdateButtonAction,
} from "../components/desktopUpdate.logic";

export function BaraUpdates() {
  const native = useDesktopUpdateState();
  const policy = usePrimaryManagedPolicy();
  const denial = window.desktopBridge ? managedUpdatesDenial(policy) : undefined;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [available, setAvailable] = useState(false);
  const desktop = Boolean(window.desktopBridge);
  const nativeAction = native?.enabled ? resolveDesktopUpdateButtonAction(native) : "check";
  const check = async () => {
    if (busy || denial) return;
    setBusy(true);
    setMessage("");
    try {
      if (desktop && native?.enabled) {
        const bridge = window.desktopBridge!;
        if (nativeAction === "download") await bridge.downloadUpdate();
        else if (nativeAction === "install") {
          if (
            await ensureLocalApi().dialogs.confirm(
              getDesktopUpdateInstallConfirmationMessage(native),
            )
          )
            await bridge.installUpdate();
        } else {
          const result = await bridge.checkForUpdate();
          if (!result.checked)
            throw new Error(result.state.message ?? "Could not check for updates.");
          setMessage(
            result.state.status === "up-to-date"
              ? "You’re up to date."
              : (result.state.message ?? "Update check complete."),
          );
        }
      } else if (desktop) {
        const response = await fetch(
          "https://api.github.com/repos/Fresh-Industries/nima/releases/latest",
          { cache: "no-store" },
        );
        if (response.status === 404) {
          setMessage("No Bara release has been published yet.");
          return;
        }
        if (!response.ok)
          throw new Error(`Release check failed (${response.status}). Try again later.`);
        const release: unknown = await response.json();
        if (
          !release ||
          typeof release !== "object" ||
          !("tag_name" in release) ||
          typeof release.tag_name !== "string"
        )
          throw new Error("The release response is incomplete.");
        const version = release.tag_name.replace(/^v/, "");
        if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version))
          throw new Error("The release version is invalid.");
        const newer = compareSemverVersions(version, APP_VERSION) > 0;
        setAvailable(newer);
        setMessage(newer ? `Bara ${version} is available.` : "You’re up to date.");
      } else {
        const url = new URL("/", location.href);
        url.searchParams.set("bara-update-check", String(Date.now()));
        const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
        if (!response.ok) throw new Error(`Update check failed (${response.status}).`);
        const html = new DOMParser().parseFromString(await response.text(), "text/html");
        const next = html.querySelector('script[type="module"][src]')?.getAttribute("src");
        const current = document.querySelector('script[type="module"][src]')?.getAttribute("src");
        if (!next || !current)
          throw new Error("Could not identify the Bara build. Try again later.");
        const newer = new URL(next, url).pathname !== new URL(current, location.href).pathname;
        setAvailable(newer);
        setMessage(
          newer
            ? "A new Bara build is ready. Reload when your work is saved."
            : "You’re up to date.",
        );
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not check for updates.");
    } finally {
      setBusy(false);
    }
  };
  const running = busy || native?.status === "checking" || native?.status === "downloading";
  return (
    <SettingsRow
      id="app-version"
      title={<AboutVersionTitle />}
      description={
        <span role="status">
          {denial ??
            (message ||
              (native?.status === "available"
                ? "A Bara update is available."
                : "Check for Bara updates."))}
        </span>
      }
      control={
        <div className="flex items-center gap-2">
          {available &&
            !denial &&
            (desktop ? (
              <Button
                size="sm"
                variant="outline"
                render={<a href={DESKTOP_DOWNLOAD_URL} target="_blank" rel="noreferrer" />}
              >
                Download update
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => location.reload()}>
                Reload Bara
              </Button>
            ))}
          <Button
            size="sm"
            variant="outline"
            disabled={running || Boolean(denial)}
            onClick={() => void check()}
          >
            {native?.status === "downloading"
              ? "Downloading…"
              : running
                ? "Checking…"
                : nativeAction === "download"
                  ? "Download update"
                  : nativeAction === "install"
                    ? "Restart & update"
                    : "Check for Updates"}
          </Button>
        </div>
      }
    />
  );
}
