import { Link, useNavigate } from "@tanstack/react-router";
import type { EnvironmentId, WorkspacePageCursor, WorkspacePageSummary } from "@t3tools/contracts";
import { WORKSPACE_NOTE_MAX_LENGTH } from "@t3tools/contracts";
import {
  Archive,
  ArrowLeft,
  ChevronRight,
  FileText,
  MoreHorizontal,
  Plus,
  RotateCcw,
} from "lucide-react";
import styles from "./nima.module.css";
import { inboxSummary } from "./inboxSummary";
import { useEffect, useState } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../components/ui/menu";
import ChatMarkdown from "../components/ChatMarkdown";
import { LiveMarkdownEditor } from "./LiveMarkdownEditor";
import { acceptPage, pageHasConflict, pageIsDirty } from "./pages";
import { useWorkspacePages } from "./useWorkspacePages";
import { WorkOnDocument } from "./WorkOnDocument";

export function Library({
  pageId,
  environmentId,
}: {
  pageId?: string;
  environmentId?: EnvironmentId;
}) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const [cursors, setCursors] = useState<WorkspacePageCursor[]>([]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- debounces full-text search subscriptions to the server
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search);
      setCursors([]);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [search]);
  const pages = useWorkspacePages(environmentId, {
    query,
    archived,
    ...(pageId ? { id: pageId } : {}),
    ...(cursors.at(-1) ? { before: cursors.at(-1)! } : {}),
  });
  const loading = pages.query.isPending && !pages.query.data;
  const remote = pages.query.data?.page;
  const selected = pageId
    ? (pages.drafts[pageId] ??
      (remote?.id === pageId ? acceptPage(undefined, remote).drafts[pageId] : undefined))
    : undefined;
  const visible = new Map((pages.query.data?.pages ?? []).map((page) => [page.id, page]));
  for (const [id, draft] of Object.entries(pages.drafts)) {
    if (!pageIsDirty(draft) && !visible.has(id)) continue;
    if (
      draft.content.archived !== archived ||
      !`${draft.content.title}\n${draft.content.markdown}`
        .toLowerCase()
        .includes(search.trim().toLowerCase())
    ) {
      visible.delete(id);
      continue;
    }
    visible.set(id, {
      id,
      title: draft.content.title,
      excerpt: draft.content.markdown.slice(0, 180),
      archived: draft.content.archived,
      revision: draft.baseRevision,
      source: draft.content.source,
      updatedAt: draft.remote?.updatedAt ?? "",
    });
  }
  const entries = [...visible.values()];
  const open = async (id?: string) => {
    if (pageId) pages.save(pageId);
    await navigate({
      to: "/spaces",
      search: {
        ...(pages.environmentId ? { environmentId: pages.environmentId } : {}),
        ...(id ? { pageId: id } : {}),
      },
    });
  };
  const add = () => {
    const id = pages.add();
    if (id) {
      setArchived(false);
      setCursors([]);
      void open(id);
    }
  };
  const toggleArchive = () => {
    if (!pageId || !selected) return;
    pages.edit(pageId, (content) => ({ ...content, archived: !content.archived }));
    pages.save(pageId);
  };
  return (
    <main
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s" && pageId) {
          event.preventDefault();
          pages.save(pageId);
        }
      }}
    >
      {pageId ? (
        <>
          <header className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-2 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <Button size="sm" variant="ghost" onClick={() => void open()}>
                <ArrowLeft />
                Library
              </Button>
              <span className="hidden text-muted-foreground/50 sm:inline" aria-hidden="true">
                /
              </span>
              <span className="hidden truncate text-sm text-muted-foreground sm:inline">
                {selected?.content.title || "Untitled"}
              </span>
            </div>
            {selected && (
              <div className="flex shrink-0 items-center gap-3">
                <span
                  className="hidden text-xs text-muted-foreground sm:inline"
                  role="status"
                  aria-live="polite"
                >
                  {pages.status(pageId) === "Saved to Bara" ? "Saved" : null}
                </span>
                {pages.environmentId && (
                  <WorkOnDocument
                    key={`${pages.environmentId}:${pageId}`}
                    environmentId={pages.environmentId}
                    pageId={pageId}
                    content={selected.content}
                  />
                )}
                <Menu>
                  <MenuTrigger
                    render={<Button size="icon-sm" variant="ghost" aria-label="Document options" />}
                  >
                    <MoreHorizontal />
                  </MenuTrigger>
                  <MenuPopup align="end">
                    <MenuItem
                      disabled={!pages.canEdit || !pages.connected || pageHasConflict(selected)}
                      onClick={() => pages.save(pageId)}
                    >
                      Save now
                    </MenuItem>
                    {selected.content.source && pages.environmentId && (
                      <MenuItem
                        render={
                          <Link
                            to="/$environmentId/$threadId"
                            params={{
                              environmentId: pages.environmentId,
                              threadId: selected.content.source.threadId,
                            }}
                          />
                        }
                      >
                        Open source conversation
                      </MenuItem>
                    )}
                    <MenuSeparator />
                    <MenuItem
                      disabled={!pages.canEdit || pageHasConflict(selected)}
                      onClick={toggleArchive}
                    >
                      {selected.content.archived ? <RotateCcw /> : <Archive />}
                      {selected.content.archived ? "Restore document" : "Archive document"}
                    </MenuItem>
                  </MenuPopup>
                </Menu>
              </div>
            )}
          </header>
          <section
            className="min-h-0 flex-1 overflow-y-auto scrollbar-gutter-both"
            aria-label="Document editor"
          >
            {selected ? (
              <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-5 pt-10 pb-16 sm:px-10 sm:pt-14">
                {selected.content.archived && (
                  <p className="mb-5 text-xs text-muted-foreground">
                    Archived · restore from the document menu.
                  </p>
                )}
                <h1>
                  <input
                    className="block w-full min-w-0 rounded-sm border-x-0 border-t-0 border-b border-transparent bg-transparent px-0 py-1 text-3xl leading-snug font-semibold tracking-tight text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring sm:text-4xl"
                    aria-label="Document title"
                    placeholder="Untitled"
                    value={selected.content.title}
                    maxLength={200}
                    readOnly={!pages.canEdit}
                    onChange={(event) =>
                      pages.edit(pageId, (content) => ({ ...content, title: event.target.value }))
                    }
                  />
                </h1>
                <div className="mt-5 min-h-64 flex-1">
                  <LiveMarkdownEditor
                    key={`${pages.environmentId}:${pageId}`}
                    appearance="document"
                    label="Document content"
                    placeholder="Start writing…"
                    value={selected.content.markdown}
                    maxLength={WORKSPACE_NOTE_MAX_LENGTH}
                    readOnly={!pages.canEdit}
                    onChange={(markdown) =>
                      pages.edit(pageId, (content) => ({ ...content, markdown }))
                    }
                  />
                </div>
                {pageHasConflict(selected) && (
                  <div
                    role="alert"
                    className="mt-6 space-y-3 rounded-lg border border-border p-4 text-sm"
                  >
                    <p>Another browser or agent changed this document. Your draft is kept.</p>
                    <details>
                      <summary>View saved version</summary>
                      <p className="my-2 font-medium">{selected.remote?.content.title}</p>
                      <ChatMarkdown
                        text={selected.remote?.content.markdown ?? ""}
                        cwd={undefined}
                        parseRawHtml={false}
                      />
                    </details>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => pages.resolve(pageId, false)}
                      >
                        Use saved version
                      </Button>
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={!pages.canEdit}
                        onClick={() => pages.resolve(pageId, true)}
                      >
                        Keep my version
                      </Button>
                    </div>
                  </div>
                )}
                {pages.status(pageId) !== "Saved to Bara" && (
                  <p
                    className="mt-4 text-xs text-muted-foreground"
                    role="status"
                    aria-live="polite"
                  >
                    {pages.status(pageId)}
                  </p>
                )}
              </div>
            ) : (
              <p
                className="mx-auto max-w-3xl px-5 py-12 text-sm text-muted-foreground"
                role="status"
              >
                {loading
                  ? "Opening document…"
                  : pages.query.error || "This document isn’t available on this connection."}
              </p>
            )}
          </section>
        </>
      ) : (
        <section
          className="min-h-0 flex-1 overflow-y-auto scrollbar-gutter-both"
          aria-labelledby="library-heading"
        >
          <div className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-10 sm:py-12">
            <header className="mb-8 flex items-center justify-between gap-4">
              <div>
                <h1 id="library-heading" className={styles["bara-page-heading"]}>
                  Library
                </h1>
              </div>
              <Button size="sm" disabled={!pages.canCreate} onClick={add}>
                <Plus />
                New document
              </Button>
            </header>
            <Input
              type="search"
              aria-label="Search documents"
              maxLength={300}
              placeholder="Search documents…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className="mt-5 mb-3 flex gap-1" role="group" aria-label="Document collection">
              <Button
                size="xs"
                variant={!archived ? "secondary" : "ghost"}
                aria-pressed={!archived}
                onClick={() => {
                  setArchived(false);
                  setCursors([]);
                }}
              >
                Documents
              </Button>
              <Button
                size="xs"
                variant={archived ? "secondary" : "ghost"}
                aria-pressed={archived}
                onClick={() => {
                  setArchived(true);
                  setCursors([]);
                }}
              >
                Archived
              </Button>
            </div>
            {pages.creationUnavailableReason && (
              <p className="mb-4 text-xs text-muted-foreground" role="status">
                {pages.creationUnavailableReason}
              </p>
            )}
            {pages.query.error && (
              <div
                role="alert"
                className="my-4 flex flex-wrap items-center gap-3 text-sm text-destructive"
              >
                {pages.query.error}
                <Button size="xs" variant="ghost" onClick={pages.query.refresh}>
                  Retry
                </Button>
              </div>
            )}
            {!pages.query.error && !entries.length && (
              <div className="py-16 text-center text-muted-foreground">
                <FileText size={28} strokeWidth={1.3} className="mx-auto mb-4" aria-hidden="true" />
                <h2 className="text-base font-medium text-foreground">
                  {loading
                    ? "Loading documents…"
                    : search
                      ? "No matching documents"
                      : archived
                        ? "No archived documents"
                        : "No documents"}
                </h2>
                {search && <p className="mx-auto mt-2 max-w-xs text-sm">Try another search</p>}
              </div>
            )}
            <ul className="divide-y divide-border/60" aria-label="Documents">
              {entries.map((page) => (
                <DocumentRow key={page.id} page={page} onOpen={() => void open(page.id)} />
              ))}
            </ul>
            <div className="mt-5 flex justify-between gap-3">
              {cursors.length > 0 && (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => setCursors((previous) => previous.slice(0, -1))}
                >
                  Newer
                </Button>
              )}
              {pages.query.data?.nextCursor && (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() =>
                    setCursors((previous) => [...previous, pages.query.data!.nextCursor!])
                  }
                >
                  Older
                </Button>
              )}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

function DocumentRow({ page, onOpen }: { page: WorkspacePageSummary; onOpen: () => void }) {
  return (
    <li>
      <button
        onClick={onOpen}
        className="group flex w-full items-center gap-4 rounded-lg px-3 py-5 text-left outline-none motion-safe:transition-colors motion-safe:duration-150 hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <FileText
          size={20}
          strokeWidth={1.4}
          className="shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{page.title || "Untitled"}</span>
          {page.excerpt && (
            <span className="mt-1 block truncate text-sm text-muted-foreground">
              {inboxSummary(page.excerpt)}
            </span>
          )}
        </span>
        {page.updatedAt && (
          <time
            dateTime={page.updatedAt}
            className="hidden shrink-0 text-xs text-muted-foreground sm:block"
          >
            {new Date(page.updatedAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </time>
        )}
        <ChevronRight size={15} className="shrink-0 text-muted-foreground/60" aria-hidden="true" />
      </button>
    </li>
  );
}
