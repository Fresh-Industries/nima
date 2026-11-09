// @effect-diagnostics nodeBuiltinImport:off -- Executes the production compiler output to reproduce the canvas startup crash.
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";
import * as React from "react";
import * as CompilerRuntime from "react/compiler-runtime";
import * as JsxRuntime from "react/jsx-runtime";
import {
  Circle,
  Eye,
  EyeOff,
  Frame,
  Hand,
  ImagePlus,
  Layers,
  Lock,
  MousePointer2,
  PanelRight,
  Pencil,
  Redo2,
  Square,
  Type,
  Undo2,
  Unlock,
  ZoomIn,
  ZoomOut,
  ChevronDown,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { transform } from "oxc-transform-react";
import { renderToStaticMarkup } from "react-dom/server";
import { EnvironmentId, type StudioSnapshot } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import type { StudioCanvas } from "./StudioCanvas";
import { Button } from "../../components/ui/button";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../../components/ui/tooltip";
import * as Utils from "../../lib/utils";
import * as StudioHooks from "./useStudio";
import * as Model from "./model";
import * as Inspector from "./StudioInspector";
import * as Curves from "./StudioCurveEditor";
import * as ImageImport from "./imageImport";
import * as WorkOnStudio from "./WorkOnStudio";
import * as SelectionBar from "./StudioSelectionBar";
import * as InlineText from "./StudioInlineText";
import { Input } from "../../components/ui/input";
import { Menu, MenuTrigger, MenuPopup, MenuItem } from "../../components/ui/menu";
import styles from "./Studio.module.css";
import { useStudio, type StudioSession } from "./useStudio";
import * as StableCallback from "../../hooks/useStableCallback";
import * as ObserveResize from "../../lib/observeResize";
import type { Asset } from "./model";

vi.mock("./useStudio", () => ({ useStudio: vi.fn(), downloadStudioFiles: vi.fn() }));

async function compiledCanvas() {
  const file = NodeURL.fileURLToPath(new URL("./StudioCanvas.tsx", import.meta.url));
  const result = await transform(file, NodeFS.readFileSync(file, "utf8"), {
    jsx: { runtime: "automatic", development: false, refresh: false },
    reactCompiler: { reportDiagnostics: true },
  });
  expect(result.errors).toEqual([]);
  const modules = {
    "react/compiler-runtime": CompilerRuntime,
    react: React,
    "react/jsx-runtime": JsxRuntime,
    "lucide-react": {
      Circle,
      Eye,
      EyeOff,
      Frame,
      Hand,
      ImagePlus,
      Layers,
      Lock,
      MousePointer2,
      PanelRight,
      Pencil,
      Redo2,
      Square,
      Type,
      Undo2,
      Unlock,
      ZoomIn,
      ZoomOut,
      ChevronDown,
      Maximize2,
      Minimize2,
    },
    "../../components/ui/button": { Button },
    "../../components/ui/input": { Input },
    "../../components/ui/menu": { Menu, MenuTrigger, MenuPopup, MenuItem },
    "./StudioSelectionBar": SelectionBar,
    "./StudioInlineText": InlineText,
    "../../components/ui/tooltip": { Tooltip, TooltipTrigger, TooltipPopup },
    "../../lib/utils": Utils,
    "./useStudio": StudioHooks,
    "./model": Model,
    "./StudioInspector": Inspector,
    "./StudioCurveEditor": Curves,
    "./imageImport": ImageImport,
    "./WorkOnStudio": WorkOnStudio,
    "./StudioChatStatus": { StudioChatStatus: () => null },
    "../../hooks/useStableCallback": StableCallback,
    "../../lib/observeResize": ObserveResize,
    "./Studio.module.css": { default: styles },
  };
  const code = result.code
    .replace(/^import (\w+) from "([^"]+)";$/gm, (_match, binding: string, path: string) => {
      if (!(path in modules)) throw new Error(`Unexpected canvas import: ${path}`);
      return `const ${binding} = modules[${JSON.stringify(path)}].default;`;
    })
    .replace(
      /^import\s+\{([^}]+)\}\s+from\s+"([^"]+)";$/gm,
      (_match, bindings: string, path: string) => {
        if (!(path in modules)) throw new Error(`Unexpected canvas import: ${path}`);
        return `const {${bindings.replace(/\s+as\s+/g, ":")}} = modules[${JSON.stringify(path)}];`;
      },
    )
    .replace(/\bexport function /g, "function ");
  return new Function("modules", `${code}\nreturn StudioCanvas;`)(modules) as typeof StudioCanvas;
}

it.each<StudioSnapshot | null>([
  null,
  { available: true, message: null, data: null, svg: null },
  {
    available: true,
    message: null,
    data: {
      revision: 1,
      head: "saved-head",
      document: { id: "canvas", title: "A saved canvas", nodes: [] },
    },
    svg: '<svg viewBox="0 0 1080 1350"></svg>',
  },
])("opens the compiled canvas while artwork loads and after it arrives: %j", async (snapshot) => {
  const session = {
    query: { data: snapshot, error: null, isPending: snapshot === null },
    connected: true,
    canWrite: true,
    busy: false,
    error: "",
  } as StudioSession;
  vi.mocked(useStudio).mockReset().mockReturnValue(session);
  const Canvas = await compiledCanvas();
  const asset: Asset = {
    id: "00000000-0000-4000-8000-000000000001",
    name: "A saved canvas",
    starred: false,
    content: { type: "artwork", document: "00000000-0000-4000-8000-000000000001" },
  };
  expect(() =>
    renderToStaticMarkup(
      <Canvas
        environmentId={EnvironmentId.make("studio-test")}
        asset={asset}
        area="design"
        catalog={session}
      />,
    ),
  ).not.toThrow();
});
