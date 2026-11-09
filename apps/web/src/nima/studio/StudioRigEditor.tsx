import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { randomUUID } from "../../lib/utils";
import { StudioChoice, StudioNumber } from "./Controls";
import { jsonRecord, type Asset, type ArtworkPin, type Joint, type Pose, type Rig } from "./model";
import type { StudioSession } from "./useStudio";

export function PoseEditor({
  pose,
  disabled,
  onChange,
}: {
  pose: Pose;
  disabled: boolean;
  onChange: (pose: Pose) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <StudioNumber
        label="Translate X"
        value={pose.translation[0]}
        step={1}
        disabled={disabled}
        onCommit={(x) => onChange({ ...pose, translation: [x, pose.translation[1]] })}
      />
      <StudioNumber
        label="Translate Y"
        value={pose.translation[1]}
        step={1}
        disabled={disabled}
        onCommit={(y) => onChange({ ...pose, translation: [pose.translation[0], y] })}
      />
      <StudioNumber
        label="Rotation"
        value={pose.rotation}
        min={-36000}
        max={36000}
        disabled={disabled}
        onCommit={(rotation) => onChange({ ...pose, rotation })}
      />
      <StudioNumber
        label="Opacity"
        value={pose.opacity}
        min={0}
        max={1}
        step={0.05}
        disabled={disabled}
        onCommit={(opacity) => onChange({ ...pose, opacity })}
      />
      <StudioNumber
        label="Scale X"
        value={pose.scale[0]}
        min={0.01}
        max={16}
        step={0.05}
        disabled={disabled}
        onCommit={(x) => onChange({ ...pose, scale: [x, pose.scale[1]] })}
      />
      <StudioNumber
        label="Scale Y"
        value={pose.scale[1]}
        min={0.01}
        max={16}
        step={0.05}
        disabled={disabled}
        onCommit={(y) => onChange({ ...pose, scale: [pose.scale[0], y] })}
      />
    </div>
  );
}

export function StudioRigEditor({
  rig,
  artwork,
  assets,
  session,
  revision,
  onChange,
}: {
  rig: Rig | null | undefined;
  artwork: ArtworkPin | null;
  assets: Asset[];
  session: StudioSession;
  revision: number;
  onChange: (artwork: ArtworkPin | null, rig: Rig | null) => void;
}) {
  const [selected, setSelected] = useState(artwork?.asset ?? ""),
    [jointId, setJointId] = useState("");
  const disabled = !session.canWrite || session.busy;
  const artworkAssets = assets.filter((asset) => asset.content.type === "artwork");
  const joint = rig?.joints.find((joint) => joint.id === jointId) ?? rig?.joints[0];
  const update = (patch: Partial<Joint>) => {
    if (rig && joint)
      onChange(artwork, {
        ...rig,
        joints: rig.joints.map((value) => (value.id === joint.id ? { ...value, ...patch } : value)),
      });
  };
  const bind = async () => {
    if (!selected) return;
    if (
      rig &&
      !window.confirm(
        "Replace this character’s rig with the current saved artwork? Existing animation instances keep their own rig.",
      )
    )
      return;
    const result = await session.write("pin", revision, null, { id: selected });
    const pin = jsonRecord(result),
      reference = jsonRecord(pin.reference);
    if (typeof reference.asset !== "string") return;
    const layers = Array.isArray(pin.layers) ? pin.layers.map(jsonRecord) : [];
    const width = Number(pin.width),
      height = Number(pin.height);
    if (
      !layers.length ||
      layers.length > 32 ||
      width < 1 ||
      height < 1 ||
      width > 4096 ||
      height > 4096
    ) {
      session.setError(
        "Rigs support 1–32 visible top-level artwork layers and a canvas up to 4096px. Group or resize the artwork first.",
      );
      return;
    }
    const origin = Array.isArray(pin.origin) ? pin.origin : [0, 0];
    const joints: Joint[] = layers.map((layer) => {
      const bounds = jsonRecord(layer.bounds),
        w = Math.max(1, Number(bounds.w)),
        h = Math.max(1, Number(bounds.h));
      return {
        id: randomUUID(),
        name: String(layer.name),
        parent: null,
        layer: String(layer.id),
        size: [w, h],
        pivot: [w / 2, h / 2],
        rest: {
          translation: [
            Number(bounds.x) - Number(origin[0]) + w / 2,
            Number(bounds.y) - Number(origin[1]) + h / 2,
          ],
          rotation: 0,
          scale: [1, 1],
          opacity: 1,
        },
      };
    });
    onChange(reference as ArtworkPin, { id: randomUUID(), size: [width, height], joints });
  };
  return (
    <details className="space-y-3 border-t border-border pt-3">
      <summary className="cursor-pointer text-sm">Character rig</summary>
      <p className="text-xs text-muted-foreground">
        Pin saved artwork to bind its visible top-level layers. Separate parts into layers before
        binding. Rig changes save with the Story; existing Motion instances stay unchanged.
      </p>
      <StudioChoice
        label="Rig artwork"
        value={selected}
        options={[
          { value: "", label: "Choose artwork" },
          ...artworkAssets.map((asset) => ({ value: asset.id, label: asset.name })),
        ]}
        disabled={disabled}
        onChange={setSelected}
      />
      <Button
        size="xs"
        variant="outline"
        disabled={disabled || !selected}
        onClick={() => void bind()}
      >
        Pin artwork and {rig ? "replace" : "create"} rig
      </Button>
      {rig && joint && (
        <>
          <StudioChoice
            label="Joint"
            value={joint.id}
            options={rig.joints.map((joint) => ({ value: joint.id, label: joint.name }))}
            disabled={disabled}
            onChange={setJointId}
          />
          <label className="grid gap-1 text-xs">
            Joint name
            <Input
              size="sm"
              value={joint.name}
              disabled={disabled}
              onChange={(event) => update({ name: event.target.value })}
            />
          </label>
          <StudioChoice
            label="Parent joint"
            value={joint.parent ?? "none"}
            options={[
              { value: "none", label: "Root" },
              ...rig.joints
                .filter((value) => value.id !== joint.id)
                .map((value) => ({ value: value.id, label: value.name })),
            ]}
            disabled={disabled}
            onChange={(value) => update({ parent: value === "none" ? null : value })}
          />
          <div className="grid grid-cols-2 gap-2">
            <StudioNumber
              label="Pivot X"
              value={joint.pivot[0]}
              disabled={disabled}
              onCommit={(x) => update({ pivot: [x, joint.pivot[1]] })}
            />
            <StudioNumber
              label="Pivot Y"
              value={joint.pivot[1]}
              disabled={disabled}
              onCommit={(y) => update({ pivot: [joint.pivot[0], y] })}
            />
          </div>
          <PoseEditor pose={joint.rest} disabled={disabled} onChange={(rest) => update({ rest })} />
          <Button
            size="xs"
            variant="ghost"
            disabled={disabled}
            onClick={() => onChange(artwork, null)}
          >
            Remove rig
          </Button>
        </>
      )}
    </details>
  );
}
