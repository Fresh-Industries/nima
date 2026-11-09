import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import type { EnvironmentId, RunId, ThreadId } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useRef, useState } from "react";
import { Button } from "../components/ui/button";
import { randomUUID } from "../lib/utils";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { receiveSavedPage } from "./pageWrites";

export function SaveResultButton({
  environmentId,
  threadId,
  runId,
  title,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  runId: RunId;
  title: string;
}) {
  const [id] = useState(randomUUID);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const allowed = useAtomValue(
    serverEnvironment.captureWorkspacePage.permissionAtom(environmentId),
  );
  const capture = useAtomCommand(serverEnvironment.captureWorkspacePage, { reportFailure: false });
  const save = async () => {
    if (lock.current) return;
    lock.current = true;
    setSaving(true);
    setError("");
    const result = await capture({
      environmentId,
      input: { id, threadId, runId, title: title.trim().slice(0, 200) || "Saved result" },
    });
    if (result._tag === "Success" && result.value.status === "saved" && result.value.page) {
      receiveSavedPage(environmentId, result.value.page);
      setSaved(true);
    } else if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setError(
        cause instanceof Error ? cause.message : "Could not save this result. Please try again.",
      );
    } else setError("This document changed elsewhere. Open Library to inspect it.");
    lock.current = false;
    setSaving(false);
  };
  return (
    <div className="flex flex-col items-start gap-1">
      {saved ? (
        <Button
          size="xs"
          variant="ghost"
          render={<Link to="/spaces" search={{ pageId: id, environmentId }} />}
        >
          Open saved document →
        </Button>
      ) : (
        <Button size="xs" variant="ghost" disabled={!allowed || saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save to Library"}
        </Button>
      )}
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}
