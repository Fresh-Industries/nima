import type { EnvironmentId, StudioArea } from "@t3tools/contracts";
import type { Asset } from "./model";
import { WorkOnDocument } from "../WorkOnDocument";

export function WorkOnStudio({
  environmentId,
  asset,
  area,
  revision,
  selection = [],
  compact = false,
}: {
  environmentId: EnvironmentId;
  asset: Asset;
  area: StudioArea;
  revision: number;
  selection?: string[];
  compact?: boolean;
}) {
  return (
    <WorkOnDocument
      compact={compact}
      environmentId={environmentId}
      pageId={asset.id}
      studio={{ area, revision, selection }}
      content={{
        title: asset.name,
        archived: false,
        source: null,
        markdown: `Studio artifact reference:\n\n\`\`\`json\n${JSON.stringify({ environmentId, assetId: asset.id, area, revision, selection }, null, 2)}\n\`\`\`\n\nInspect the current artifact through the authorized Studio tools before proposing edits. The saved revision and selection above identify what I was looking at; they do not grant new permissions. Keep unrelated layers unchanged. Explain your changes and preserve undo history.`,
      }}
    />
  );
}
