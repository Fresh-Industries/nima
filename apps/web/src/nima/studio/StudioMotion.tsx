import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Copy, Download, Film, Play, Trash2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import { randomUUID } from "../../lib/utils";
import { useStableCallback } from "../../hooks/useStableCallback";
import { StudioNumber, StudioChoice } from "./Controls";
import { jsonRecord, type Asset, type Catalog, type Json } from "./model";
import { downloadStudioExport, type StudioSession } from "./useStudio";
import { uploadStudioMedia } from "./mediaUpload";
import { StudioKeyframeEditor } from "./StudioKeyframeEditor";
import styles from "./Studio.module.css";
import { WorkOnStudio } from "./WorkOnStudio";

type Camera = {
  moving: boolean;
  start: { center: [number, number]; zoom: number };
  end: { center: [number, number]; zoom: number };
  easing: "linear" | "smooth";
};
export function StudioMotion({
  asset,
  catalog,
  session,
}: {
  asset: Asset;
  catalog: Catalog;
  session: StudioSession;
}) {
  const sequence = asset.content.type === "motion" ? asset.content.sequence : null;
  const [selected, setSelected] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);
  const [preview, setPreview] = useState("");
  const [movie, setMovie] = useState("");
  const previousMovie = useRef<string | null>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const loadFrame = async (frame: number, id?: string, revision?: number) => {
    const result = await session.download({
      kind: "motion_frame",
      id: id ?? asset.id,
      expectedRevision: revision ?? catalog.revision,
      frame,
    });
    if (result?.files[0]) setPreview(`data:image/png;base64,${result.files[0].base64}`);
  };
  const refreshPreview = async (id: string, revision: number) => {
    setMovie("");
    if (previousMovie.current) URL.revokeObjectURL(previousMovie.current);
    previousMovie.current = null;
    const total = sequence?.shots.reduce((sum, shot) => sum + shot.frames, 0) ?? 0;
    const playhead = Math.min(frame, Math.max(total - 1, 0));
    setFrame(playhead);
    if (total) await loadFrame(playhead, id, revision);
    else setPreview("");
  };
  const refreshPreviewStable = useStableCallback(refreshPreview);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- refreshes the engine-rendered frame when the saved sequence changes
  useEffect(() => {
    if (session.canWrite) void refreshPreviewStable(asset.id, catalog.revision);
  }, [asset.id, catalog.revision, session.canWrite, refreshPreviewStable]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- releases the browser's owned movie URL when this editor closes
  useEffect(
    () => () => {
      if (previousMovie.current) URL.revokeObjectURL(previousMovie.current);
    },
    [],
  );
  if (!sequence) return null;
  const frames = sequence.shots.reduce((sum, shot) => sum + shot.frames, 0);
  const clip = sequence.shots.find((shot) => shot.id === selected) ?? sequence.shots[0];
  const camera = (clip?.camera ?? {
    moving: false,
    start: { center: [0.5, 0.5], zoom: 1 },
    end: { center: [0.5, 0.5], zoom: 1 },
    easing: "smooth",
  }) as Camera;
  const edit = (commands: unknown[]) =>
    session.write("studio", catalog.revision, {
      type: "edit",
      commands: [{ op: "edit_motion_sequence", id: asset.id, commands }],
    });
  const changeCamera = (update: Partial<Camera>) =>
    clip && void edit([{ op: "camera", id: clip.id, camera: { ...camera, ...update } }]);
  const exportMovie = async (play: boolean) => {
    const result = await session.download({
      kind: "motion",
      id: asset.id,
      expectedRevision: catalog.revision,
      delivery: play ? "base64" : "stream",
    });
    if (!result) return;
    if (!play) {
      await downloadStudioExport(result);
      return;
    }
    const file = result.files.find((file) => file.mimeType === "video/mp4");
    if (!file) return;
    const blob = new Blob(
      [Uint8Array.from(atob(file.base64), (character) => character.charCodeAt(0))],
      { type: "video/mp4" },
    );
    if (previousMovie.current) URL.revokeObjectURL(previousMovie.current);
    const url = URL.createObjectURL(blob);
    previousMovie.current = url;
    setMovie(url);
  };
  const enabled = session.canWrite && !session.busy && !uploading;
  const importAudio = async (file: File) => {
    if (!session.environmentId || uploading) return;
    if (file.size > 256 * 1024 * 1024) {
      session.setError("Audio originals support up to 256 MiB.");
      return;
    }
    setUploading(true);
    try {
      const uploaded = await uploadStudioMedia(session.environmentId, file);
      await session.write(
        "import_audio",
        catalog.revision,
        { attachmentId: uploaded.attachmentId, name: file.name, frame, lane: "music" },
        { id: asset.id },
      );
      uploaded.release();
    } catch (cause) {
      session.setError(cause instanceof Error ? cause.message : "Audio import failed.");
    }
    setUploading(false);
  };
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Motion editor">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <span className="text-xs text-muted-foreground">
          24 fps · {Math.round((frames / 24) * 10) / 10} seconds · {sequence.shots.length} shots
        </span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={propertiesOpen}
            onClick={() => setPropertiesOpen(!propertiesOpen)}
          >
            Clip settings
          </Button>
          {session.environmentId && (
            <WorkOnStudio
              environmentId={session.environmentId}
              asset={asset}
              area="motion"
              revision={catalog.revision}
              selection={clip ? [clip.id] : []}
            />
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={!enabled || !frames}
            onClick={() => void exportMovie(true)}
          >
            <Play />
            {session.busy ? "Rendering…" : "Preview movie"}
          </Button>
          <Button size="sm" disabled={!enabled || !frames} onClick={() => void exportMovie(false)}>
            <Download />
            Export MP4
          </Button>
        </div>
      </header>
      <div className={styles.canvasBody}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto scrollbar-gutter-both p-5">
          <div
            className={`${styles.motionPreview} flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg bg-black`}
          >
            {movie ? (
              <video
                controls
                src={movie}
                className="max-h-full w-full"
                aria-label="Rendered Motion preview"
              />
            ) : preview ? (
              <img
                src={preview}
                className="max-h-full w-full object-contain"
                alt={`Motion preview at frame ${frame}`}
              />
            ) : (
              <div className="p-8 text-sm text-muted-foreground">
                <Film size={28} className="mx-auto mb-3" />
                Render a preview of your saved sequence.
              </div>
            )}
          </div>
          <label className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
            <span className="shrink-0">Frame {frame}</span>
            <input
              className="min-w-0 flex-1 accent-primary"
              type="range"
              aria-label="Motion playhead"
              min={0}
              max={Math.max(frames - 1, 0)}
              value={Math.min(frame, Math.max(frames - 1, 0))}
              disabled={!enabled}
              onChange={(event) => setFrame(Number(event.target.value))}
              onPointerUp={(event) => {
                setMovie("");
                void loadFrame(Number(event.currentTarget.value));
              }}
              onKeyUp={(event) => {
                if (event.key.startsWith("Arrow")) {
                  setMovie("");
                  void loadFrame(Number(event.currentTarget.value));
                }
              }}
            />
            <Button
              size="xs"
              variant="ghost"
              disabled={!enabled}
              onClick={() => {
                setMovie("");
                void loadFrame(frame);
              }}
            >
              Render frame
            </Button>
          </label>
          <section className={styles.timeline} aria-label="Shot timeline">
            <div className={styles.timelineHeading}>
              <span>Timeline</span>
              <span>{sequence.shots.length} shots · 24 fps</span>
            </div>
            <div className={styles.timelineRuler} aria-hidden="true">
              {[0, 1, 2, 3, 4].map((tick) => (
                <span key={tick}>{(((frames / 24) * tick) / 4).toFixed(1)}s</span>
              ))}
            </div>
            <div className={styles.timelineClips}>
              {sequence.shots.map((shot, index) => (
                <button
                  key={shot.id}
                  onClick={() => {
                    setSelected(shot.id);
                    const start = sequence.shots
                      .slice(0, index)
                      .reduce((sum, shot) => sum + shot.frames, 0);
                    setFrame(start);
                    if (enabled) {
                      setMovie("");
                      void loadFrame(start);
                    }
                  }}
                  className={styles.timelineClip}
                  style={{ flex: `${shot.frames} 0 90px` }}
                  aria-pressed={clip?.id === shot.id}
                >
                  <span className="max-w-48 truncate text-xs font-medium">{shot.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {(shot.frames / 24).toFixed(1)}s
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>
        <aside
          className={`${styles.panel} ${!propertiesOpen ? styles.panelHidden : ""} space-y-5`}
          aria-label="Motion properties"
        >
          <Button
            size="xs"
            variant="ghost"
            aria-label="Close clip settings"
            onClick={() => setPropertiesOpen(false)}
          >
            Close settings
          </Button>
          {clip && (
            <>
              <h2 className="text-sm font-medium">{clip.name}</h2>
              <StudioNumber
                label="Duration (seconds)"
                value={Math.round((clip.frames / 24) * 100) / 100}
                min={1 / 24}
                max={600}
                step={1 / 24}
                disabled={!enabled}
                onCommit={(seconds) =>
                  void edit([
                    { op: "duration", id: clip.id, frames: Math.max(1, Math.round(seconds * 24)) },
                  ])
                }
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label="Move clip earlier"
                  disabled={!enabled || sequence.shots[0]?.id === clip.id}
                  onClick={() =>
                    void edit([
                      {
                        op: "reorder",
                        id: clip.id,
                        index: sequence.shots.findIndex((shot) => shot.id === clip.id) - 1,
                      },
                    ])
                  }
                >
                  <ArrowLeft />
                </Button>
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label="Move clip later"
                  disabled={!enabled || sequence.shots.at(-1)?.id === clip.id}
                  onClick={() =>
                    void edit([
                      {
                        op: "reorder",
                        id: clip.id,
                        index: sequence.shots.findIndex((shot) => shot.id === clip.id) + 1,
                      },
                    ])
                  }
                >
                  <ArrowRight />
                </Button>
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label="Duplicate clip"
                  disabled={!enabled}
                  onClick={() =>
                    void edit([{ op: "duplicate", id: clip.id, new_id: randomUUID() }])
                  }
                >
                  <Copy />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Remove clip and its anchored audio"
                  disabled={!enabled}
                  onClick={() => void edit([{ op: "remove", id: clip.id, remove_audio: true }])}
                >
                  <Trash2 />
                </Button>
              </div>
              <StudioKeyframeEditor
                key={clip.id}
                clip={clip}
                catalog={catalog}
                playhead={
                  frame -
                  sequence.shots
                    .slice(
                      0,
                      sequence.shots.findIndex((shot) => shot.id === clip.id),
                    )
                    .reduce((sum, shot) => sum + shot.frames, 0)
                }
                disabled={!enabled}
                onEdit={edit}
              />
              <section className="space-y-3 border-t border-border/60 pt-4">
                <h3 className="text-xs font-medium">Camera</h3>
                <Button
                  size="xs"
                  variant={camera.moving ? "secondary" : "outline"}
                  aria-pressed={camera.moving}
                  disabled={!enabled}
                  onClick={() => changeCamera({ moving: !camera.moving })}
                >
                  {camera.moving ? "Pan & zoom enabled" : "Enable pan & zoom"}
                </Button>
                {(["start", "end"] as const).map((end) => (
                  <div key={end} className="space-y-2">
                    <h4 className="text-xs text-muted-foreground">
                      {end === "start" ? "Start" : "End"}
                    </h4>
                    <StudioNumber
                      label={`${end} zoom`}
                      value={camera[end].zoom}
                      min={1}
                      max={4}
                      step={0.1}
                      disabled={!enabled}
                      onCommit={(zoom) => changeCamera({ [end]: { ...camera[end], zoom } })}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      {([0, 1] as const).map((index) => (
                        <StudioNumber
                          key={index}
                          label={`${end} ${index === 0 ? "X" : "Y"} (%)`}
                          value={camera[end].center[index] * 100}
                          min={0}
                          max={100}
                          disabled={!enabled}
                          onCommit={(value) =>
                            changeCamera({
                              [end]: {
                                ...camera[end],
                                center:
                                  index === 0
                                    ? [value / 100, camera[end].center[1]]
                                    : [camera[end].center[0], value / 100],
                              },
                            })
                          }
                        />
                      ))}
                    </div>
                  </div>
                ))}
                <StudioChoice
                  label="Camera easing"
                  value={camera.easing}
                  options={["smooth", "linear"]}
                  disabled={!enabled}
                  onChange={(easing) => changeCamera({ easing: easing as Camera["easing"] })}
                />
              </section>
            </>
          )}
          <section className="space-y-3 border-t border-border/60 pt-4">
            <h3 className="text-xs font-medium">Audio tracks</h3>
            <Button
              size="xs"
              variant="outline"
              disabled={!enabled || !session.canUpload || !frames}
              onClick={() => audioInput.current?.click()}
            >
              {uploading ? "Importing…" : "Import WAV or MP3"}
            </Button>
            <input
              ref={audioInput}
              type="file"
              accept="audio/wav,audio/mpeg,.wav,.mp3"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importAudio(file);
                event.target.value = "";
              }}
            />
            {sequence.audio.length ? (
              sequence.audio.map((value, index) => {
                const audio = jsonRecord(value);
                const original = catalog.studio.assets.find((asset) => asset.id === audio.original);
                const media =
                  original?.content.type === "audio" ? jsonRecord(original.content.media) : {};
                const rate = Number(media.sample_rate ?? 48000);
                const update = (change: Record<string, Json>) =>
                  void edit([{ op: "update_audio", clip: { ...audio, ...change } }]);
                return (
                  <div key={String(audio.id ?? index)} className="space-y-2">
                    <p className="text-xs">{String(audio.name ?? "Audio")}</p>
                    <StudioNumber
                      label="Volume"
                      value={Number(audio.volume ?? 1)}
                      min={0}
                      max={2}
                      step={0.1}
                      disabled={!enabled}
                      onCommit={(volume) =>
                        void edit([{ op: "update_audio", clip: { ...audio, volume } }])
                      }
                    />
                    <StudioChoice
                      label="Lane"
                      value={String(audio.lane ?? "music")}
                      options={["music", "voice"]}
                      disabled={!enabled}
                      onChange={(lane) => update({ lane })}
                    />
                    <StudioNumber
                      label="Start at frame"
                      value={Number(jsonRecord(audio.anchor).frame ?? 0)}
                      min={0}
                      max={Math.max(0, frames - 1)}
                      disabled={!enabled}
                      onCommit={(frame) => update({ anchor: { type: "sequence", frame } })}
                    />
                    <StudioNumber
                      label="Source in (seconds)"
                      value={Number(audio.in_sample ?? 0) / rate}
                      min={0}
                      max={Math.max(0, (Number(audio.out_sample ?? 1) - 1) / rate)}
                      step={0.01}
                      disabled={!enabled}
                      onCommit={(seconds) => update({ in_sample: Math.round(seconds * rate) })}
                    />
                    <StudioNumber
                      label="Source out (seconds)"
                      value={Number(audio.out_sample ?? 0) / rate}
                      min={(Number(audio.in_sample ?? 0) + 1) / rate}
                      max={Number(media.frames ?? 0) / rate}
                      step={0.01}
                      disabled={!enabled}
                      onCommit={(seconds) => update({ out_sample: Math.round(seconds * rate) })}
                    />
                    <StudioNumber
                      label="Fade in (frames)"
                      value={Number(audio.fade_in_frames ?? 0)}
                      min={0}
                      max={Math.floor(
                        ((Number(audio.out_sample ?? 0) - Number(audio.in_sample ?? 0)) * 24) /
                          rate,
                      )}
                      disabled={!enabled}
                      onCommit={(fade_in_frames) => update({ fade_in_frames })}
                    />
                    <StudioNumber
                      label="Fade out (frames)"
                      value={Number(audio.fade_out_frames ?? 0)}
                      min={0}
                      max={Math.floor(
                        ((Number(audio.out_sample ?? 0) - Number(audio.in_sample ?? 0)) * 24) /
                          rate,
                      )}
                      disabled={!enabled}
                      onCommit={(fade_out_frames) => update({ fade_out_frames })}
                    />
                    <div className="flex gap-2">
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={!enabled}
                        onClick={() =>
                          void edit([
                            { op: "update_audio", clip: { ...audio, muted: !audio.muted } },
                          ])
                        }
                      >
                        {audio.muted ? "Unmute" : "Mute"}
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={!enabled}
                        onClick={() => void edit([{ op: "remove_audio", id: audio.id }])}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="text-xs text-muted-foreground">No audio tracks in this sequence.</p>
            )}
          </section>
        </aside>
      </div>
    </section>
  );
}
