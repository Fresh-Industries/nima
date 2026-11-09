import { useState } from "react";
import { Button } from "../../components/ui/button";
import { randomUUID } from "../../lib/utils";
import { StudioChoice, StudioNumber } from "./Controls";
import { PoseEditor } from "./StudioRigEditor";
import {
  jsonRecord,
  type Animation,
  type Catalog,
  type Json,
  type Keyframe,
  type Rig,
} from "./model";

type Clip = { id: string; frames: number; source: Json };
export function StudioKeyframeEditor({
  clip,
  catalog,
  playhead,
  disabled,
  onEdit,
}: {
  clip: Clip;
  catalog: Catalog;
  playhead: number;
  disabled: boolean;
  onEdit: (commands: unknown[]) => Promise<Json | null>;
}) {
  const [placementId, setPlacementId] = useState(""),
    [jointId, setJointId] = useState(""),
    [keyId, setKeyId] = useState("");
  const composition = jsonRecord(jsonRecord(clip.source).composition);
  const placements = Array.isArray(composition.placements)
    ? composition.placements.map(jsonRecord)
    : [];
  const placement = placements.find((value) => value.id === placementId) ?? placements[0];
  const raw = jsonRecord(placement?.animation),
    rig = jsonRecord(raw.rig);
  const animation =
    Array.isArray(rig.joints) && Array.isArray(raw.tracks) ? (raw as unknown as Animation) : null;
  const joint =
    animation?.rig.joints.find((value) => value.id === jointId) ?? animation?.rig.joints[0];
  const keys = animation?.tracks.find((track) => track.joint === joint?.id)?.keys ?? [];
  const key = keys.find((value) => value.id === keyId) ?? keys[0];
  const frame = Math.min(clip.frames - 1, Math.max(0, Math.round(playhead)));
  const pin = jsonRecord(placement?.artwork);
  const templates = catalog.studio.assets.flatMap((asset) =>
    asset.content.type === "story"
      ? asset.content.story.characters
          .filter(
            (character) =>
              character.rig &&
              character.artwork &&
              character.artwork.asset === pin.asset &&
              character.artwork.document === pin.document &&
              character.artwork.snapshot === pin.snapshot &&
              character.artwork.frame === pin.frame,
          )
          .map((character) => ({ id: character.id, name: character.name, rig: character.rig! }))
      : [],
  );
  const save = (next: Animation | null) =>
    onEdit([{ op: "animate", id: clip.id, placement: placement?.id, animation: next }]);
  const saveKeys = async (next: Keyframe[]) => {
    if (!animation || !joint) return null;
    const tracks = animation.tracks.filter((track) => track.joint !== joint.id);
    if (next.length)
      tracks.push({ joint: joint.id, keys: [...next].sort((a, b) => a.frame - b.frame) });
    return save({ ...animation, tracks });
  };
  const update = (patch: Partial<Keyframe>) => {
    if (key)
      void saveKeys(keys.map((value) => (value.id === key.id ? { ...value, ...patch } : value)));
  };
  const applyRig = (next: Rig) => {
    if (
      animation?.tracks.some((track) => track.keys.length) &&
      !window.confirm(
        "Replace this instance’s rig and remove its keyframes? Studio undo retains the previous version.",
      )
    )
      return;
    void save({ rig: next, tracks: [] });
  };
  return (
    <section className="space-y-3 border-t border-border pt-4" aria-label="Character animation">
      <h3 className="text-xs font-medium">Character animation</h3>
      {!placement ? (
        <p className="text-xs text-muted-foreground">
          Add artwork as a composition placement in Story, then refresh this shot to animate it.
        </p>
      ) : (
        <>
          <StudioChoice
            label="Animated placement"
            value={String(placement.id)}
            options={placements.map((value) => ({
              value: String(value.id),
              label: String(value.name ?? "Artwork"),
            }))}
            disabled={disabled}
            onChange={(value) => {
              setPlacementId(value);
              setJointId("");
              setKeyId("");
            }}
          />
          {!!templates.length && (
            <StudioChoice
              label="Apply saved character rig"
              value="choose"
              options={[
                { value: "choose", label: "Choose a character" },
                ...templates.map((template) => ({ value: template.id, label: template.name })),
              ]}
              disabled={disabled}
              onChange={(id) => {
                const template = templates.find((value) => value.id === id);
                if (template) applyRig(template.rig);
              }}
            />
          )}
          {!animation && (
            <p className="text-xs text-muted-foreground">
              Create and save a character rig using this exact pinned artwork in Story. Then apply
              that rig here.
            </p>
          )}
          {animation && joint && (
            <>
              <StudioChoice
                label="Animated joint"
                value={joint.id}
                options={animation.rig.joints.map((value) => ({
                  value: value.id,
                  label: value.name,
                }))}
                disabled={disabled}
                onChange={(value) => {
                  setJointId(value);
                  setKeyId("");
                }}
              />
              <p className="text-xs text-muted-foreground">
                Clip frame {frame} · 24 fps. New keys copy the selected key’s pose, or the joint’s
                rest pose. Render a frame to inspect the engine result.
              </p>
              <Button
                size="xs"
                variant="outline"
                disabled={
                  disabled ||
                  keys.length >= 128 ||
                  animation.tracks.reduce((count, track) => count + track.keys.length, 0) >= 1024
                }
                onClick={async () => {
                  const existing = keys.find((value) => value.frame === frame);
                  if (existing) {
                    setKeyId(existing.id);
                    return;
                  }
                  const id = randomUUID();
                  const result = await saveKeys([
                    ...keys,
                    { id, frame, pose: key?.pose ?? joint.rest, timing: "linear" },
                  ]);
                  if (result) setKeyId(id);
                }}
              >
                Add key at playhead
              </Button>
              {!!keys.length && (
                <StudioChoice
                  label="Keyframe"
                  value={key?.id ?? ""}
                  options={keys.map((value) => ({
                    value: value.id,
                    label: `Frame ${value.frame}`,
                  }))}
                  disabled={disabled}
                  onChange={setKeyId}
                />
              )}
              {key && (
                <>
                  <StudioNumber
                    label="Keyframe position"
                    value={key.frame}
                    min={0}
                    max={Math.max(0, clip.frames - 1)}
                    disabled={disabled}
                    onCommit={(frame) => {
                      if (!keys.some((value) => value.id !== key.id && value.frame === frame))
                        update({ frame });
                    }}
                  />
                  <StudioChoice
                    label="Interpolation"
                    value={key.timing}
                    options={["linear", "stepped", "eased"]}
                    disabled={disabled}
                    onChange={(timing) => {
                      if (timing === "linear" || timing === "stepped" || timing === "eased")
                        update({ timing });
                    }}
                  />
                  <PoseEditor
                    pose={key.pose}
                    disabled={disabled}
                    onChange={(pose) => update({ pose })}
                  />
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => void saveKeys(keys.filter((value) => value.id !== key.id))}
                  >
                    Remove keyframe
                  </Button>
                </>
              )}
              <Button
                size="xs"
                variant="ghost"
                disabled={disabled}
                onClick={() => {
                  if (
                    window.confirm(
                      "Remove this instance’s rig and animation? Studio undo keeps the previous version.",
                    )
                  )
                    void save(null);
                }}
              >
                Remove animation
              </Button>
            </>
          )}
        </>
      )}
    </section>
  );
}
