import { useRouter } from "@tanstack/react-router";
import {
  scopeProjectRef,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type WorkspacePageContent,
} from "@t3tools/contracts";
import { ArrowUpRight } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "../components/ui/button";
import { fileAttachmentCapabilityBlockReason } from "../components/chat/composerAttachmentFiles";
import { useComposerDraftStore, type ComposerThreadTarget } from "../composerDraftStore";
import { useThreadRouteTarget } from "../hooks/useThreadRouteTarget";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useScratchProject } from "../hooks/useScratchProject";
import { startAttachmentUpload } from "../lib/attachmentUploadQueue";
import { randomUUID } from "../lib/utils";
import { useProjects, useQuietThreadShell } from "../state/entities";
import { useEnvironment } from "../state/environments";
import { useEnvironmentScope } from "../state/session";
import { documentWorkAttachment, type StudioWorkSource } from "./documentWork";
import { useNimaStore } from "./store";

export function WorkOnDocument({
  environmentId,
  pageId,
  content,
  studio,
  compact = false,
}: {
  environmentId: EnvironmentId;
  pageId: string;
  content: WorkspacePageContent;
  studio?: StudioWorkSource;
  compact?: boolean;
}) {
  const environment = useEnvironment(environmentId);
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const projects = useProjects().filter(
    (project) => project.environmentId === environmentId && project.archivedAt == null,
  );
  const sourceThread = useQuietThreadShell(
    content.source ? scopeThreadRef(environmentId, content.source.threadId) : null,
  );
  const sourceProject = projects.find((project) => project.id === sourceThread?.projectId);
  const scratch = useScratchProject();
  const scratchRoot = scratch.scratchWorkspaceRootFor(environmentId);
  const handleNew = useNewThreadHandler();
  const router = useRouter();
  const target = useThreadRouteTarget();
  const draftSession = useComposerDraftStore((state) =>
    target?.kind === "draft" ? state.getDraftSession(target.draftId) : undefined,
  );
  const chatTarget =
    studio && target?.kind === "server" && target.threadRef.environmentId === environmentId
      ? target.threadRef
      : studio && target?.kind === "draft" && draftSession?.environmentId === environmentId
        ? target.draftId
        : null;
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const unavailable =
    environment?.connection.phase !== "connected"
      ? "Reconnect to Bara to start focused work."
      : !canOperate
        ? "This connection cannot start agent work."
        : !sourceProject && !scratchRoot && !projects.length
          ? "Open a workspace on this server to start focused work."
          : null;
  const openSession = async () => {
    const href = router.state.location.href;
    const file = documentWorkAttachment(
      window.location.origin,
      environmentId,
      pageId,
      content,
      studio,
    );
    const config = environment?.serverConfig;
    const blocked = fileAttachmentCapabilityBlockReason({
      attachmentUploadsCapabilityKnown: config != null,
      supportsAttachmentUploads: config != null,
      maxFileAttachmentBytes:
        config?.environment.capabilities.fileAttachments?.maxUploadBytes ?? null,
      files: [{ name: file.name, sizeBytes: file.size }],
    });
    if (blocked) return blocked;
    const attach = (draftTarget: ComposerThreadTarget) => {
      const attachment = {
        id: randomUUID(),
        type: "file" as const,
        name: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        file,
      };
      useComposerDraftStore
        .getState()
        .addFiles(draftTarget, [attachment], { appendReference: false });
      startAttachmentUpload({ environmentId, image: attachment, draftTarget });
    };
    if (chatTarget) {
      attach(chatTarget);
      useNimaStore.getState().expandSurface(false);
      if (window.matchMedia("(max-width: 1100px)").matches)
        useNimaStore.getState().setUtilityOpen(false);
      document.querySelector<HTMLElement>('[data-testid="composer-editor"]')?.focus();
      return null;
    }
    const project =
      sourceProject ??
      (scratchRoot ? await scratch.openScratchProject(environmentId) : projects[0]);
    if (router.state.location.href !== href) return null;
    if (!project) return "Could not open a workspace for this document. Please try again.";
    const opened = await handleNew(scopeProjectRef(environmentId, project.id), {
      prompt: "I'd like to work on the attached document.\n\n",
      reuseEmptyDraft: false,
      envMode: "local",
    });
    if (!opened) return "The Focus Session could not open. Please try again.";
    attach(opened.draftId);
    useNimaStore
      .getState()
      .rememberFocus(scopedThreadKey(scopeThreadRef(environmentId, opened.threadId)), {
        title: `Work on ${content.title.trim() || "Untitled"}`,
        objective: `Working with ${content.title.trim() || "Untitled"} from ${studio ? "Studio" : "Library"}.`,
        review: false,
      });
    if (studio) {
      useNimaStore.getState().expandSurface(false);
      useNimaStore.getState().openStudio({ environmentId, area: studio.area, id: pageId });
    }
    return null;
  };
  const open = async () => {
    if (lock.current || unavailable) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      setError((await openSession()) ?? "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start focused work.");
    }
    lock.current = false;
    setBusy(false);
  };
  const actionLabel = busy
    ? "Opening…"
    : chatTarget
      ? studio?.selection.length
        ? "Use selection in chat"
        : "Use in chat"
      : studio?.selection.length
        ? "Ask about selection"
        : "Work on this";
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="outline"
        disabled={busy || Boolean(unavailable)}
        aria-label={actionLabel}
        title={
          unavailable ??
          (chatTarget
            ? "Attach to your current message. Nothing is sent."
            : "Open a Focus Session with this document attached.")
        }
        onClick={() => void open()}
      >
        {compact ? "Chat" : actionLabel}
        <ArrowUpRight />
      </Button>
      {error && (
        <span role="alert" className="max-w-48 text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}
