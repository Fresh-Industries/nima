import { useStudioLeaveGuard } from "./navigation";
import { useState } from "react";
import { ArrowDown, ArrowUp, Copy, Download, Film, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { randomUUID } from "../../lib/utils";
import { StudioField, StudioNumber, StudioChoice } from "./Controls";
import {
  jsonRecord,
  type Asset,
  type Catalog,
  type Story,
  type Shot,
  type ArtworkPin,
} from "./model";
import { downloadStudioFiles, type StudioSession } from "./useStudio";
import { StudioRigEditor } from "./StudioRigEditor";
import styles from "./Studio.module.css";
import { WorkOnStudio } from "./WorkOnStudio";

export function StudioStory({
  asset,
  catalog,
  session,
  onMotion,
}: {
  asset: Asset;
  catalog: Catalog;
  session: StudioSession;
  onMotion: (id: string) => void;
}) {
  const original = asset.content.type === "story" ? asset.content.story : null;
  const [draft, setDraft] = useState<Story | null>(null);
  const [baseRevision, setBaseRevision] = useState<number | null>(null);
  const [baseStory, setBaseStory] = useState<Story | null>(null);
  const [tab, setTab] = useState<"board" | "script" | "world" | "characters">("board");
  const [premiseOpen, setPremiseOpen] = useState(!original?.premise);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const story = draft ?? original;
  useStudioLeaveGuard(Boolean(draft), "Leave this story and discard your unsaved changes?");
  if (!story) return null;
  const change = (update: (story: Story) => Story) => {
    if (!draft) {
      setBaseRevision(catalog.revision);
      setBaseStory(original);
    }
    setDraft((current) => update(current ?? story));
  };
  const updateShot = (sceneId: string, shotId: string, update: (shot: Shot) => Shot) =>
    change((current) => ({
      ...current,
      scenes: current.scenes.map((scene) =>
        scene.id !== sceneId
          ? scene
          : {
              ...scene,
              shots: scene.shots.map((shot) => (shot.id === shotId ? update(shot) : shot)),
            },
      ),
    }));
  const save = async () => {
    if (!draft) return true;
    const submitted = draft;
    const expectedRevision =
      baseStory && JSON.stringify(baseStory) === JSON.stringify(original)
        ? catalog.revision
        : (baseRevision ?? catalog.revision);
    const saved = await session.write("studio", expectedRevision, {
      type: "edit",
      commands: [{ op: "set_story", id: asset.id, story: draft }],
    });
    if (saved) {
      setDraft((current) => (current === submitted ? null : current));
      const revision = jsonRecord(saved).revision;
      setBaseRevision(typeof revision === "number" ? revision : null);
      setBaseStory(submitted);
      return true;
    }
    return false;
  };
  const addScene = () =>
    change((current) => ({
      ...current,
      scenes: [
        ...current.scenes,
        { id: randomUUID(), title: `Scene ${current.scenes.length + 1}`, script: "", shots: [] },
      ],
    }));
  const addShot = (sceneId: string) =>
    change((current) => ({
      ...current,
      scenes: current.scenes.map((scene) =>
        scene.id !== sceneId
          ? scene
          : {
              ...scene,
              shots: [
                ...scene.shots,
                {
                  id: randomUUID(),
                  title: `Shot ${scene.shots.length + 1}`,
                  description: "",
                  duration_ms: 3000,
                  artwork: null,
                },
              ],
            },
      ),
    }));
  const moveShot = (sceneId: string, index: number, delta: number) =>
    change((current) => ({
      ...current,
      scenes: current.scenes.map((scene) => {
        if (scene.id !== sceneId) return scene;
        const shots = [...scene.shots];
        const target = index + delta;
        if (target < 0 || target >= shots.length) return scene;
        [shots[index], shots[target]] = [shots[target]!, shots[index]!];
        return { ...scene, shots };
      }),
    }));
  const attachArtwork = async (sceneId: string, shotId: string, artworkId: string) => {
    const result = await session.write("pin", catalog.revision, null, { id: artworkId });
    if (!result || typeof result !== "object" || Array.isArray(result)) return;
    const pin = (jsonRecord(result).reference ?? result) as ArtworkPin;
    if (typeof pin.asset !== "string") return;
    const w = typeof jsonRecord(result).width === "number" ? jsonRecord(result).width : 1280,
      h = typeof jsonRecord(result).height === "number" ? jsonRecord(result).height : 720;
    const width = Number(w),
      height = Number(h);
    const scale = Math.min(1280 / width, 720 / height);
    updateShot(sceneId, shotId, (shot) => ({
      ...shot,
      artwork: null,
      composition: {
        width: shot.composition?.width ?? 1280,
        height: shot.composition?.height ?? 720,
        background: shot.composition?.background ?? [20, 20, 25, 255],
        placements: [
          ...(shot.composition?.placements ?? []),
          {
            id: randomUUID(),
            name: catalog.studio.assets.find((asset) => asset.id === artworkId)?.name ?? "Artwork",
            artwork: pin,
            bounds: {
              x: (1280 - width * scale) / 2,
              y: (720 - height * scale) / 2,
              w: width * scale,
              h: height * scale,
            },
            rotation: 0,
            locked: false,
          },
        ],
      },
    }));
    if (typeof jsonRecord(result).preview === "string")
      setPreviews((current) => ({ ...current, [shotId]: jsonRecord(result).preview as string }));
  };
  const exportStory = async (previewOnly = false) => {
    if (draft) {
      session.setError("Save your story before exporting or refreshing previews.");
      return;
    }
    const result = await session.download({
      kind: "story",
      id: asset.id,
      expectedRevision: catalog.revision,
    });
    if (!result) return;
    const images: Record<string, string> = {};
    for (const file of result.files) {
      const match = file.name.match(/shot-([0-9a-f-]+)\.png$/);
      if (match) images[match[1]!] = `data:image/png;base64,${file.base64}`;
    }
    setPreviews((current) => ({ ...current, ...images }));
    if (!previewOnly) await downloadStudioFiles([...result.files]);
  };
  const createMotion = async () => {
    if (draft) {
      session.setError("Save your story before creating a Motion sequence.");
      return;
    }
    const id = randomUUID();
    const result = await session.write("motion_from_story", catalog.revision, {
      story: asset.id,
      scene: null,
      asset: id,
      document: randomUUID(),
      item: randomUUID(),
      name: asset.name,
      clips: story.scenes.flatMap((scene) => scene.shots.map(() => randomUUID())),
    });
    if (result) onMotion(id);
  };
  const artworkOptions = catalog.studio.assets.filter((asset) => asset.content.type === "artwork");
  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Story editor">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <nav className="flex flex-wrap gap-1" aria-label="Story views">
          {(["board", "script", "world", "characters"] as const).map((view) => (
            <Button
              key={view}
              size="sm"
              variant={tab === view ? "secondary" : "ghost"}
              aria-pressed={tab === view}
              onClick={() => setTab(view)}
            >
              {view === "board" ? "Storyboard" : view.charAt(0).toUpperCase() + view.slice(1)}
            </Button>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          {!draft && session.environmentId && (
            <WorkOnStudio
              environmentId={session.environmentId}
              asset={asset}
              area="story"
              revision={catalog.revision}
            />
          )}
          <span className="text-xs text-muted-foreground" role="status">
            {draft ? "Unsaved changes" : "Saved"}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={!session.canWrite || session.busy || Boolean(draft)}
            onClick={() => void createMotion()}
          >
            <Film />
            Create motion
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!session.canWrite || session.busy || Boolean(draft)}
            onClick={() => void exportStory()}
          >
            <Download />
            Export
          </Button>
          <Button
            size="sm"
            disabled={!session.canWrite || session.busy || !draft}
            onClick={() => void save()}
          >
            <Save />
            {session.busy ? "Saving…" : "Save story"}
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-gutter-both">
        <fieldset
          disabled={!session.canWrite}
          className={`${styles.story} space-y-8`}
          data-view={tab}
        >
          <details
            open={premiseOpen}
            onToggle={(event) => setPremiseOpen(event.currentTarget.open)}
            className={styles.premise}
          >
            <summary>Story premise</summary>
            <StudioField label="Premise">
              <Textarea
                aria-label="Story premise"
                value={story.premise}
                placeholder="What is this story about?"
                onChange={(event) =>
                  change((current) => ({ ...current, premise: event.target.value }))
                }
              />
            </StudioField>
          </details>
          {tab === "world" && (
            <StudioField label="World notes">
              <Textarea
                aria-label="World notes"
                value={story.world}
                placeholder="The setting, its rules, and what makes it yours…"
                onChange={(event) =>
                  change((current) => ({ ...current, world: event.target.value }))
                }
              />
            </StudioField>
          )}
          {tab === "characters" && (
            <section className="space-y-5">
              {story.characters.map((character) => (
                <div key={character.id} className="space-y-3 border-b border-border/60 pb-5">
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <Input
                        aria-label="Character name"
                        value={character.name}
                        placeholder="Character name"
                        onChange={(event) =>
                          change((current) => ({
                            ...current,
                            characters: current.characters.map((c) =>
                              c.id === character.id ? { ...c, name: event.target.value } : c,
                            ),
                          }))
                        }
                      />
                    </div>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Remove ${character.name}`}
                      onClick={() =>
                        change((current) => ({
                          ...current,
                          characters: current.characters.filter((c) => c.id !== character.id),
                        }))
                      }
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  <Textarea
                    aria-label={`Notes for ${character.name}`}
                    value={character.notes}
                    placeholder="Their story, personality, and visual direction…"
                    onChange={(event) =>
                      change((current) => ({
                        ...current,
                        characters: current.characters.map((c) =>
                          c.id === character.id ? { ...c, notes: event.target.value } : c,
                        ),
                      }))
                    }
                  />
                  <StudioRigEditor
                    rig={character.rig}
                    artwork={character.artwork}
                    assets={catalog.studio.assets}
                    session={session}
                    revision={catalog.revision}
                    onChange={(artwork, rig) =>
                      change((current) => ({
                        ...current,
                        characters: current.characters.map((value) =>
                          value.id === character.id ? { ...value, artwork, rig } : value,
                        ),
                      }))
                    }
                  />
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  change((current) => ({
                    ...current,
                    characters: [
                      ...current.characters,
                      { id: randomUUID(), name: "New character", notes: "", artwork: null },
                    ],
                  }))
                }
              >
                <Plus />
                Add character
              </Button>
            </section>
          )}
          {(tab === "board" || tab === "script") && (
            <>
              {story.scenes.map((scene) => (
                <section key={scene.id} className="space-y-5">
                  <header className="flex items-center justify-between gap-3">
                    <div className="max-w-md flex-1">
                      <Input
                        aria-label="Scene title"
                        value={scene.title}
                        onChange={(event) =>
                          change((current) => ({
                            ...current,
                            scenes: current.scenes.map((s) =>
                              s.id === scene.id ? { ...s, title: event.target.value } : s,
                            ),
                          }))
                        }
                      />
                    </div>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Remove ${scene.title}`}
                      onClick={() =>
                        change((current) => ({
                          ...current,
                          scenes: current.scenes.filter((s) => s.id !== scene.id),
                        }))
                      }
                    >
                      <Trash2 />
                    </Button>
                  </header>
                  {tab === "script" ? (
                    <textarea
                      className={styles.scriptInput}
                      aria-label={`Script for ${scene.title}`}
                      value={scene.script}
                      placeholder="Action, dialogue, and scene direction…"
                      onChange={(event) =>
                        change((current) => ({
                          ...current,
                          scenes: current.scenes.map((s) =>
                            s.id === scene.id ? { ...s, script: event.target.value } : s,
                          ),
                        }))
                      }
                    />
                  ) : (
                    <>
                      <div className="grid grid-cols-1 gap-4 @min-[40rem]/studio:grid-cols-2 @min-[68rem]/studio:grid-cols-3">
                        {scene.shots.map((shot, index) => (
                          <article
                            key={shot.id}
                            className="overflow-hidden rounded-xl border border-border/70"
                          >
                            <div className="flex aspect-video items-center justify-center bg-muted/30">
                              {previews[shot.id] ? (
                                <img
                                  src={previews[shot.id]}
                                  alt={shot.title}
                                  className="h-full w-full object-contain"
                                />
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  {shot.composition?.placements.length
                                    ? "Artwork pinned · refresh previews after saving"
                                    : "Add artwork to this shot"}
                                </span>
                              )}
                            </div>
                            <div className="space-y-3 p-4">
                              <Input
                                aria-label="Shot title"
                                value={shot.title}
                                onChange={(event) =>
                                  updateShot(scene.id, shot.id, (shot) => ({
                                    ...shot,
                                    title: event.target.value,
                                  }))
                                }
                              />
                              <Textarea
                                aria-label={`Direction for ${shot.title}`}
                                size="sm"
                                value={shot.description}
                                placeholder="Action, camera, dialogue…"
                                onChange={(event) =>
                                  updateShot(scene.id, shot.id, (shot) => ({
                                    ...shot,
                                    description: event.target.value,
                                  }))
                                }
                              />
                              <StudioNumber
                                label="Duration (seconds)"
                                value={shot.duration_ms / 1000}
                                min={0.1}
                                max={600}
                                step={0.1}
                                onCommit={(seconds) =>
                                  updateShot(scene.id, shot.id, (shot) => ({
                                    ...shot,
                                    duration_ms: Math.round(seconds * 1000),
                                  }))
                                }
                              />
                              {artworkOptions.length > 0 && (
                                <StudioChoice
                                  label="Add artwork"
                                  value="choose"
                                  options={[
                                    { value: "choose", label: "Choose saved artwork" },
                                    ...artworkOptions.map((asset) => ({
                                      value: asset.id,
                                      label: asset.name,
                                    })),
                                  ]}
                                  onChange={(id) => {
                                    if (id !== "choose") void attachArtwork(scene.id, shot.id, id);
                                  }}
                                />
                              )}
                              {shot.composition?.placements.map((placement) => (
                                <details key={placement.id}>
                                  <summary className="cursor-pointer text-xs text-muted-foreground">
                                    {placement.name} · placement
                                  </summary>
                                  <div className="mt-3 grid grid-cols-2 gap-2">
                                    {(["x", "y", "w", "h"] as const).map((key) => (
                                      <StudioNumber
                                        key={key}
                                        label={{ x: "X", y: "Y", w: "Width", h: "Height" }[key]}
                                        value={placement.bounds[key]}
                                        min={key === "w" || key === "h" ? 1 : -100000}
                                        max={100000}
                                        onCommit={(value) =>
                                          updateShot(scene.id, shot.id, (shot) => ({
                                            ...shot,
                                            composition: shot.composition
                                              ? {
                                                  ...shot.composition,
                                                  placements: shot.composition.placements.map(
                                                    (p) =>
                                                      p.id === placement.id
                                                        ? {
                                                            ...p,
                                                            bounds: { ...p.bounds, [key]: value },
                                                          }
                                                        : p,
                                                  ),
                                                }
                                              : null,
                                          }))
                                        }
                                      />
                                    ))}
                                  </div>
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    <Button
                                      size="xs"
                                      variant="ghost"
                                      onClick={() =>
                                        updateShot(scene.id, shot.id, (current) => ({
                                          ...current,
                                          composition: current.composition
                                            ? {
                                                ...current.composition,
                                                placements: current.composition.placements.filter(
                                                  (item) => item.id !== placement.id,
                                                ),
                                              }
                                            : null,
                                        }))
                                      }
                                    >
                                      Remove placement
                                    </Button>
                                    <StudioNumber
                                      label="Rotation"
                                      value={placement.rotation}
                                      min={-360}
                                      max={360}
                                      onCommit={(rotation) =>
                                        updateShot(scene.id, shot.id, (current) => ({
                                          ...current,
                                          composition: current.composition
                                            ? {
                                                ...current.composition,
                                                placements: current.composition.placements.map(
                                                  (item) =>
                                                    item.id === placement.id
                                                      ? { ...item, rotation }
                                                      : item,
                                                ),
                                              }
                                            : null,
                                        }))
                                      }
                                    />
                                  </div>
                                </details>
                              ))}
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs text-muted-foreground">
                                  Shot {index + 1}
                                </span>
                                <div className="flex gap-1">
                                  <Button
                                    size="icon-xs"
                                    variant="ghost"
                                    aria-label="Move shot earlier"
                                    disabled={index === 0}
                                    onClick={() => moveShot(scene.id, index, -1)}
                                  >
                                    <ArrowUp />
                                  </Button>
                                  <Button
                                    size="icon-xs"
                                    variant="ghost"
                                    aria-label="Move shot later"
                                    disabled={index === scene.shots.length - 1}
                                    onClick={() => moveShot(scene.id, index, 1)}
                                  >
                                    <ArrowDown />
                                  </Button>
                                  <Button
                                    size="icon-xs"
                                    variant="ghost"
                                    aria-label="Duplicate shot"
                                    onClick={() =>
                                      change((current) => ({
                                        ...current,
                                        scenes: current.scenes.map((s) =>
                                          s.id === scene.id
                                            ? {
                                                ...s,
                                                shots: s.shots.flatMap((candidate) =>
                                                  candidate.id === shot.id
                                                    ? [
                                                        candidate,
                                                        {
                                                          ...candidate,
                                                          id: randomUUID(),
                                                          title: `${candidate.title} copy`,
                                                          composition: candidate.composition
                                                            ? {
                                                                ...candidate.composition,
                                                                placements:
                                                                  candidate.composition.placements.map(
                                                                    (p) => ({
                                                                      ...p,
                                                                      id: randomUUID(),
                                                                    }),
                                                                  ),
                                                              }
                                                            : null,
                                                        },
                                                      ]
                                                    : [candidate],
                                                ),
                                              }
                                            : s,
                                        ),
                                      }))
                                    }
                                  >
                                    <Copy />
                                  </Button>
                                  <Button
                                    size="icon-xs"
                                    variant="ghost"
                                    aria-label="Remove shot"
                                    onClick={() =>
                                      change((current) => ({
                                        ...current,
                                        scenes: current.scenes.map((s) =>
                                          s.id === scene.id
                                            ? {
                                                ...s,
                                                shots: s.shots.filter(
                                                  (candidate) => candidate.id !== shot.id,
                                                ),
                                              }
                                            : s,
                                        ),
                                      }))
                                    }
                                  >
                                    <Trash2 />
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                      <Button size="sm" variant="outline" onClick={() => addShot(scene.id)}>
                        <Plus />
                        Add shot
                      </Button>
                    </>
                  )}
                </section>
              ))}
              <div className="flex flex-wrap gap-3">
                <Button size="sm" variant="outline" onClick={addScene}>
                  <Plus />
                  Add scene
                </Button>
                {tab === "board" && story.scenes.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={Boolean(draft)}
                    onClick={() => void exportStory(true)}
                  >
                    Refresh saved previews
                  </Button>
                )}
              </div>
            </>
          )}
        </fieldset>
      </div>
    </section>
  );
}
