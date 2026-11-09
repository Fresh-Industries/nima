import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  StudioMutationInput,
  StudioReadInput,
  StudioExportInput,
} from "@t3tools/contracts";
import { useRef, useState } from "react";
import { usePrimaryEnvironmentId, useEnvironment } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { assetEnvironment } from "../../state/assets";
import { readPreparedConnection } from "../../state/session";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { randomUUID } from "../../lib/utils";
import { jsonRecord, studioJson } from "./model";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import { useEnvironmentScope } from "../../state/session";

function studioMessage(cause: unknown, fallback: string) {
  if (!(cause instanceof Error)) return fallback;
  try {
    const message = jsonRecord(JSON.parse(cause.message)).error;
    return typeof message === "string" ? message : cause.message;
  } catch {
    return cause.message;
  }
}

export function useStudio(input: StudioReadInput, host?: EnvironmentId) {
  const primary = usePrimaryEnvironmentId();
  const environmentId = host ?? primary;
  const environment = useEnvironment(environmentId);
  const query = useEnvironmentQuery(
    environmentId ? serverEnvironment.studioLive({ environmentId, input }) : null,
  );
  const canWrite = useAtomValue(serverEnvironment.mutateStudio.permissionAtom(environmentId));
  const canUpload = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const mutate = useAtomCommand(serverEnvironment.mutateStudio, { reportFailure: false });
  const exportFile = useAtomCommand(serverEnvironment.exportStudio, { reportFailure: false });
  const createAssetUrl = useAtomQueryRunner(assetEnvironment.createUrl, {
    reportFailure: false,
    refresh: true,
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [committed, setCommitted] = useState<{ target: string; revision: number } | null>(null);
  const target = JSON.stringify([environmentId, input.scope, input.id ?? null]);
  const data = jsonRecord(query.data?.data);
  const revision =
    input.scope === "recordings" ? jsonRecord(data.selected).revision : data.revision;
  const awaitingSave =
    committed !== null &&
    committed.target === target &&
    (typeof revision !== "number" || revision < committed.revision);
  const lock = useRef(false);
  const connected = environment?.connection.phase === "connected";
  const write = async (
    operation: StudioMutationInput["operation"],
    expectedRevision: number,
    payload: unknown,
    options: Pick<StudioMutationInput, "id" | "area" | "name"> = {},
  ) => {
    if (!environmentId || !connected || !canWrite || lock.current || awaitingSave) return null;
    lock.current = true;
    setBusy(true);
    setError("");
    const result = await mutate({
      environmentId,
      input: {
        operation,
        expectedRevision,
        payload: studioJson(payload),
        requestId: randomUUID(),
        ...options,
      },
    });
    lock.current = false;
    setBusy(false);
    if (result._tag === "Success") {
      const receipt = jsonRecord(result.value);
      // Artwork receipts use current_revision; Studio catalog receipts use revision.
      const revision = receipt.current_revision ?? receipt.revision;
      const matchingWrite =
        (input.scope === "studio" && operation === "studio") ||
        (input.scope === "artwork" &&
          input.id === options.id &&
          (operation === "artwork" || operation === "photo_crop")) ||
        (input.scope === "live" && operation === "live") ||
        (input.scope === "recordings" &&
          input.id === options.id &&
          operation.startsWith("recording_"));
      if (matchingWrite && typeof revision === "number") setCommitted({ target, revision });
      return result.value;
    }
    const cause = squashAtomCommandFailure(result);
    setError(studioMessage(cause, "Studio could not save this change."));
    return null;
  };
  const download = async (input: StudioExportInput) => {
    if (!environmentId || !connected || !canWrite || lock.current || awaitingSave) return null;
    lock.current = true;
    setBusy(true);
    setError("");
    const delivery = environment?.serverConfig?.environment.capabilities.studioDownloads
      ? (input.delivery ??
        (input.kind === "motion" || input.kind === "live" || input.kind === "recording"
          ? "stream"
          : "base64"))
      : "base64";
    const result = await exportFile({ environmentId, input: { ...input, delivery } });
    lock.current = false;
    setBusy(false);
    if (result._tag === "Success") {
      const downloads: { name: string; mimeType: string; url: string }[] = [];
      const connection = readPreparedConnection(environmentId);
      for (const item of result.value.downloads ?? []) {
        const signed = await createAssetUrl({
          environmentId,
          input: {
            resource: {
              _tag: "attachment",
              attachmentId: item.attachmentId,
              fileName: item.name.split("/").at(-1) ?? item.name,
              mimeType: item.mimeType,
              disposition: "attachment",
            },
          },
        });
        const url =
          signed._tag === "Success" && connection
            ? resolveAssetUrl(connection.httpBaseUrl, signed.value.relativeUrl)
            : null;
        if (!url) {
          setError(
            "The export was saved, but a download link could not be created. Reconnect and export again.",
          );
          return null;
        }
        downloads.push({ name: item.name, mimeType: item.mimeType, url });
      }
      return { ...result.value, downloads };
    }
    const cause = squashAtomCommandFailure(result);
    setError(studioMessage(cause, "Studio could not export this file."));
    return null;
  };
  return {
    environmentId,
    query,
    write,
    download,
    busy: busy || awaitingSave,
    error,
    setError,
    canWrite: canWrite && connected,
    connected,
    canUpload: canUpload && connected && canWrite,
  };
}
export type StudioSession = ReturnType<typeof useStudio>;
export async function downloadStudioExport(result: {
  files: readonly { name: string; mimeType: string; base64: string }[];
  downloads?: readonly { name: string; url: string }[];
}) {
  for (const file of result.downloads ?? []) {
    const anchor = document.createElement("a");
    anchor.href = file.url;
    anchor.download = file.name.split("/").at(-1) ?? file.name;
    anchor.rel = "noopener";
    anchor.click();
  }
  if (result.files.length) await downloadStudioFiles([...result.files]);
}
export async function downloadStudioFiles(
  files: { readonly name: string; readonly mimeType: string; readonly base64: string }[],
) {
  let blob: Blob;
  let name: string;
  if (files.length === 1) {
    const file = files[0]!;
    blob = new Blob([Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0))], {
      type: file.mimeType,
    });
    name = file.name;
  } else {
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    for (const file of files) zip.file(file.name, file.base64, { base64: true });
    blob = await zip.generateAsync({ type: "blob" });
    name = "bara-studio-export.zip";
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
