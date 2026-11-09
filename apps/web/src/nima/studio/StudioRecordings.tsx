import type { EnvironmentId } from "@t3tools/contracts";
import { useStudioLeaveGuard } from "./navigation";
import { useEffect, useRef, useState } from "react";
import { Download, Film, Play, Plus, RotateCcw, Square, Trash2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { randomUUID } from "../../lib/utils";
import { StudioField } from "./Controls";
import { uploadStudioMedia } from "./mediaUpload";
import { downloadStudioExport, useStudio } from "./useStudio";
import styles from "./Studio.module.css";

interface Cue {
  start_ms: number;
  end_ms: number;
  text: string;
}
interface Recording {
  id: string;
  name: string;
  revision: number;
  archived: boolean;
  status: "queued" | "transcribing" | "ready" | "failed" | "cancelled";
  durationMs: number;
  error: string | null;
}
interface RecordingData {
  configured: boolean;
  message: string | null;
  recordings: Recording[];
  selected:
    | (Recording & {
        clip: { duration_ms: number; in_ms: number; out_ms: number; cues: Cue[] } | null;
      })
    | null;
}

export function StudioRecordings({
  id,
  environmentId,
  onOpen,
}: {
  id?: string;
  environmentId?: EnvironmentId;
  onOpen: (id?: string) => void;
}) {
  const session = useStudio({ scope: "recordings", ...(id ? { id } : {}) }, environmentId);
  const data = session.query.data?.data as RecordingData | null | undefined;
  const [archived, setArchived] = useState(false),
    [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState("");
  const selected = data?.selected;
  const upload = async (file: File) => {
    if (!session.environmentId) return;
    setUploading(true);
    session.setError("");
    try {
      if (file.size > 256 * 1024 * 1024)
        throw new Error("Choose a recording smaller than 256 MiB.");
      const uploaded = await uploadStudioMedia(session.environmentId, file);
      try {
        const id = randomUUID();
        const result = await session.write(
          "recording_transcribe",
          0,
          { attachmentId: uploaded.attachmentId },
          { id, name: file.name },
        );
        if (result) onOpen(id);
      } finally {
        uploaded.release();
      }
    } catch (error) {
      session.setError(
        error instanceof Error ? error.message : "The recording could not be uploaded.",
      );
    } finally {
      setUploading(false);
    }
  };
  const error = session.error || session.query.error;
  return (
    <section className="min-h-0 flex-1 overflow-y-auto scrollbar-gutter-both px-5 py-8 sm:px-10">
      <div className={`${styles.recordings} space-y-6`}>
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              {selected?.name ?? "Recordings"}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Transcribe a video locally, edit its captions, and export a clip.
            </p>
          </div>
          <label className="relative inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-inset focus-within:ring-ring has-disabled:cursor-default has-disabled:opacity-50">
            <Plus size={14} />
            {uploading ? "Uploading…" : "Import recording"}
            <input
              className="absolute inset-0 cursor-pointer opacity-0"
              aria-label="Import recording"
              type="file"
              accept="video/mp4,video/webm,video/quicktime,.mkv"
              disabled={!session.canUpload || session.busy || uploading || !data?.configured}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void upload(file);
              }}
            />
          </label>
        </header>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {data?.message && (
          <p role="status" className="max-w-2xl text-sm text-muted-foreground">
            {data.message}
          </p>
        )}
        {session.query.isPending && !data ? (
          <p role="status" className="text-sm text-muted-foreground">
            Opening recordings…
          </p>
        ) : selected ? (
          <>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span role="status">
                {selected.status === "transcribing"
                  ? "Transcribing locally…"
                  : selected.status === "queued"
                    ? "Queued for transcription"
                    : selected.status}
              </span>
              {selected.status === "queued" || selected.status === "transcribing" ? (
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!session.canWrite || session.busy}
                  onClick={() =>
                    void session.write(
                      "recording_cancel",
                      selected.revision,
                      {},
                      { id: selected.id },
                    )
                  }
                >
                  <Square />
                  Cancel
                </Button>
              ) : selected.status === "failed" || selected.status === "cancelled" ? (
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!session.canWrite || session.busy || !data?.configured}
                  onClick={() =>
                    void session.write(
                      "recording_transcribe",
                      selected.revision,
                      {},
                      { id: selected.id },
                    )
                  }
                >
                  <RotateCcw />
                  Retry transcription
                </Button>
              ) : null}
              <Button
                size="xs"
                variant="ghost"
                disabled={!session.canWrite || session.busy}
                onClick={() =>
                  void session.write(
                    selected.archived ? "recording_restore" : "recording_archive",
                    selected.revision,
                    {},
                    { id: selected.id },
                  )
                }
              >
                {selected.archived ? <RotateCcw /> : <Trash2 />}
                {selected.archived ? "Restore" : "Archive"}
              </Button>
            </div>
            {selected.error && (
              <p role="alert" className="text-sm text-destructive">
                {selected.error}
              </p>
            )}
            {selected.clip && (
              <Transcript key={selected.id} recording={selected} session={session} />
            )}
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex gap-1" role="group" aria-label="Recording collection">
                {[false, true].map((value) => (
                  <Button
                    key={String(value)}
                    size="xs"
                    variant={archived === value ? "secondary" : "ghost"}
                    onClick={() => setArchived(value)}
                  >
                    {value ? "Archived" : "Recordings"}
                  </Button>
                ))}
              </div>
              <div className="w-full sm:w-64">
                <Input
                  type="search"
                  aria-label="Find recordings"
                  placeholder="Find a recording…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
            </div>
            <div className="divide-y divide-border/60">
              {data?.recordings
                .filter(
                  (item) =>
                    item.archived === archived &&
                    item.name.toLowerCase().includes(search.toLowerCase()),
                )
                .map((item) => (
                  <button
                    key={item.id}
                    className={styles.recordingRow}
                    onClick={() => onOpen(item.id)}
                  >
                    <span className={styles.recordingIcon}>
                      <Film size={20} strokeWidth={1.5} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <strong className="truncate">{item.name}</strong>
                      <small>
                        {item.durationMs
                          ? `${Math.floor(item.durationMs / 60000)}:${String(Math.floor(item.durationMs / 1000) % 60).padStart(2, "0")} · Video`
                          : "Video"}
                      </small>
                    </span>
                    <span className={styles.recordingStatus}>
                      {item.status === "ready" ? "Ready to edit" : item.status}
                    </span>
                  </button>
                ))}
            </div>
            {!data?.recordings.some(
              (item) =>
                item.archived === archived &&
                item.name.toLowerCase().includes(search.toLowerCase()),
            ) && (
              <p className="py-12 text-center text-sm text-muted-foreground">
                {search
                  ? "No recordings match your search."
                  : archived
                    ? "No archived recordings."
                    : "Import a video with audio to get started. Originals stay on this host."}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function Transcript({
  recording,
  session,
}: {
  recording: RecordingData["selected"] & {};
  session: ReturnType<typeof useStudio>;
}) {
  const [preview, setPreview] = useState<{ url: string; revision: number } | null>(null);
  const ownedPreview = useRef<string | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- releases the browser-owned clip preview when the recording editor closes
  useEffect(
    () => () => {
      if (ownedPreview.current) URL.revokeObjectURL(ownedPreview.current);
    },
    [],
  );
  const previewClip = async () => {
    const result = await session.download({
      kind: "recording",
      id: recording.id,
      expectedRevision: recording.revision,
      delivery: "stream",
    });
    if (!result) return;
    const link = result.downloads.find((file) => file.mimeType === "video/mp4");
    const inline = result.files.find((file) => file.mimeType === "video/mp4");
    if (!link && !inline) return;
    if (ownedPreview.current) URL.revokeObjectURL(ownedPreview.current);
    ownedPreview.current = inline
      ? URL.createObjectURL(
          new Blob([Uint8Array.from(atob(inline.base64), (value) => value.charCodeAt(0))], {
            type: "video/mp4",
          }),
        )
      : null;
    setPreview({ url: link?.url ?? ownedPreview.current!, revision: recording.revision });
  };
  const [draft, setDraft] = useState<{
    revision: number;
    clip: NonNullable<typeof recording.clip>;
  } | null>(null);
  useStudioLeaveGuard(
    Boolean(draft),
    "Leave this recording and discard your unsaved transcript edits?",
  );
  const clip = draft?.clip ?? recording.clip!;
  const enabled = session.canWrite && !session.busy && recording.status === "ready";
  const update = (patch: Partial<typeof clip>) =>
    setDraft({ revision: draft?.revision ?? recording.revision, clip: { ...clip, ...patch } });
  const save = async () => {
    if (!draft) return;
    const result = await session.write("recording_edit", draft.revision, draft.clip, {
      id: recording.id,
    });
    if (result) setDraft(null);
  };
  return (
    <div className="space-y-5">
      {preview?.revision === recording.revision && (
        <video
          controls
          src={preview.url}
          aria-label="Recording clip preview"
          className="max-h-96 w-full rounded-lg bg-black"
        />
      )}
      {draft && draft.revision !== recording.revision && (
        <p role="alert" className="text-sm text-muted-foreground">
          This recording changed elsewhere. Your draft is preserved; discard it to load the saved
          revision.
        </p>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <StudioField label="Clip starts (seconds)">
          <Input
            type="number"
            min={0}
            max={clip.duration_ms / 1000}
            step={0.1}
            value={clip.in_ms / 1000}
            disabled={!enabled}
            onChange={(e) => {
              if (Number.isFinite(e.target.valueAsNumber))
                update({ in_ms: Math.round(e.target.valueAsNumber * 1000) });
            }}
          />
        </StudioField>
        <StudioField label="Clip ends (seconds)">
          <Input
            type="number"
            min={0}
            max={clip.duration_ms / 1000}
            step={0.1}
            value={clip.out_ms / 1000}
            disabled={!enabled}
            onChange={(e) => {
              if (Number.isFinite(e.target.valueAsNumber))
                update({ out_ms: Math.round(e.target.valueAsNumber * 1000) });
            }}
          />
        </StudioField>
        <Button
          size="sm"
          disabled={!enabled || !draft || draft.revision !== recording.revision}
          onClick={() => void save()}
        >
          Save edits
        </Button>
        {draft && (
          <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
            Discard draft
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={!enabled || !!draft}
          onClick={() => void previewClip()}
        >
          <Play /> Preview clip
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!enabled || !!draft}
          onClick={() =>
            void session
              .download({
                kind: "recording",
                id: recording.id,
                expectedRevision: recording.revision,
              })
              .then((result) => result && downloadStudioExport(result))
          }
        >
          <Download />
          Export clip & captions
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Exports include an MP4, separate SRT captions, and editable transcript JSON. Captions are
        not burned into the video.
      </p>
      <div className="space-y-4">
        {clip.cues.map((cue, index) => (
          <StudioField
            key={`${cue.start_ms}:${cue.end_ms}`}
            label={`${(cue.start_ms / 1000).toFixed(1)}–${(cue.end_ms / 1000).toFixed(1)} seconds`}
          >
            <Textarea
              aria-label={`Transcript segment ${index + 1}`}
              value={cue.text}
              maxLength={4000}
              disabled={!enabled}
              onChange={(e) =>
                update({
                  cues: clip.cues.map((item, i) =>
                    i === index ? { ...item, text: e.target.value } : item,
                  ),
                })
              }
            />
          </StudioField>
        ))}
      </div>
    </div>
  );
}
