import type { ProjectContextRecord } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { FolderIcon } from "lucide-react";
import { ContextChip, ContextChipLabel } from "./ContextChip";

export function ProjectContextChip({
  record,
  copyMarkdown,
}: {
  record: ProjectContextRecord;
  copyMarkdown?: string;
}) {
  return (
    <ContextChip
      kind="mention"
      aria-label={`Project, ${record.title}`}
      data-markdown-copy={copyMarkdown}
      render={
        <Link
          to="/work"
          search={{ environmentId: record.environmentId, projectId: record.projectId }}
        />
      }
    >
      <FolderIcon />
      <ContextChipLabel>@{record.title}</ContextChipLabel>
    </ContextChip>
  );
}
