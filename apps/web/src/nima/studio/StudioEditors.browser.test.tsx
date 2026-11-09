import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../../test/render";
import "~/index.css";
import { setAppearanceMode } from "~/hooks/useTheme";
import { StudioCurveEditor, StudioCurveHandles } from "./StudioCurveEditor";
import { StudioKeyframeEditor } from "./StudioKeyframeEditor";
import type { Catalog, Json, Node, Rig } from "./model";
import { StudioNumber } from "./Controls";

it("keeps native precision when leaving a rounded numeric control unchanged", async () => {
  const onCommit = vi.fn();
  await using screen = await render(
    <>
      <StudioNumber
        label="Line height"
        value={1.2000000476837158}
        min={0}
        max={10}
        onCommit={onCommit}
      />
      <button>Outside</button>
    </>,
  );
  const input = screen.getByRole("spinbutton", { name: "Line height", exact: true });
  await expect.element(input).toHaveValue(1.2);
  await input.click();
  await screen.getByRole("button", { name: "Outside", exact: true }).click();
  expect(onCommit).not.toHaveBeenCalled();
  await input.fill("-1");
  await screen.getByRole("button", { name: "Outside", exact: true }).click();
  await expect.element(input).toHaveValue(1.2);
  expect(onCommit).not.toHaveBeenCalled();
  await input.fill("");
  await screen.getByRole("button", { name: "Outside", exact: true }).click();
  await expect.element(input).toHaveValue(1.2);
  await input.fill("1.5");
  await screen.getByRole("button", { name: "Outside", exact: true }).click();
  expect(onCommit).toHaveBeenCalledWith(1.5);
});

it("edits native curve handles and keyframes through the rendered controls", async () => {
  const point = (x: number, y: number) => ({
    point: { x, y },
    incoming: { x, y },
    outgoing: { x, y },
  });
  const node: Node = {
    id: "curve",
    name: "Curve",
    parent: null,
    bounds: { x: 20, y: 20, w: 240, h: 180 },
    fill: [180, 160, 210, 255],
    visible: true,
    locked: false,
    kind: { type: "path", closed: true, points: [point(0, 0), point(1, 0), point(0.5, 1)] },
  };
  const rig: Rig = {
    id: "rig",
    size: [280, 220],
    joints: [
      {
        id: "joint",
        name: "Body",
        parent: null,
        layer: "curve",
        size: [240, 180],
        pivot: [120, 90],
        rest: { translation: [140, 110], rotation: 0, scale: [1, 1], opacity: 1 },
      },
    ],
  };
  const animation = { rig, tracks: [] };
  const curveEdit = vi.fn(async (_commands: unknown[]) => null);
  const motionEdit = vi.fn(async (_commands: unknown[]) => ({ saved: true }));
  function Editors() {
    const [clip, setClip] = useState({
      id: "clip",
      frames: 24,
      source: {
        type: "composition",
        composition: {
          placements: [
            { id: "placement", name: "Character", artwork: { asset: "art" }, animation },
          ],
        },
      },
    });
    return (
      <main className="grid gap-6 bg-background p-6 text-foreground sm:grid-cols-2">
        <div>
          <svg viewBox="0 0 280 220" className="w-full rounded border border-border">
            <path d="M20 20 L260 20 L140 200 Z" fill="var(--primary)" />
            <StudioCurveHandles node={node} viewWidth={280} disabled={false} onEdit={curveEdit} />
          </svg>
          <StudioCurveEditor node={node} disabled={false} onEdit={curveEdit} />
        </div>
        <StudioKeyframeEditor
          clip={clip as { id: string; frames: number; source: Json }}
          catalog={{ studio: { assets: [] } } as unknown as Catalog}
          playhead={12}
          disabled={false}
          onEdit={async (commands) => {
            const result = await motionEdit(commands);
            const change = commands[0] as { animation: typeof animation };
            setClip({
              ...clip,
              source: {
                ...clip.source,
                composition: {
                  placements: [
                    { ...clip.source.composition.placements[0]!, animation: change.animation },
                  ],
                },
              },
            });
            return result;
          }}
        />
      </main>
    );
  }
  await page.viewport(1000, 900);
  // These native document controls have no routes or environment connection.
  await using _screen = await render(<Editors />, { router: false });
  await page.getByRole("button", { name: "Split next segment", exact: true }).click();
  expect(curveEdit).toHaveBeenCalledWith([
    { op: "edit_curve", id: "curve", edit: { contour: 0, type: "split", segment: 0, t: 0.5 } },
  ]);
  page.getByRole("button", { name: "Contour 1 point 1 outgoing", exact: true }).element().focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(curveEdit).toHaveBeenLastCalledWith([
    {
      op: "edit_curve",
      id: "curve",
      edit: {
        type: "move",
        contour: 0,
        anchor: 0,
        part: "outgoing",
        point: { x: 0.001, y: 0 },
        independent: false,
      },
    },
  ]);
  await page.getByRole("button", { name: "Add key at playhead", exact: true }).click();
  await expect
    .element(page.getByRole("spinbutton", { name: "Keyframe position", exact: true }))
    .toHaveValue(12);
  await page.getByRole("spinbutton", { name: "Rotation", exact: true }).fill("25");
  await userEvent.keyboard("{Enter}");
  await expect
    .element(page.getByRole("spinbutton", { name: "Rotation", exact: true }))
    .toHaveValue(25);
  setAppearanceMode("dark");
  await page.screenshot({ path: "/workspace/nima/.t3/bara-creative-editors-dark.png" });
  await page.viewport(420, 900);
  await page.screenshot({ path: "/workspace/nima/.t3/bara-creative-editors-narrow.png" });
  setAppearanceMode("light");
});
