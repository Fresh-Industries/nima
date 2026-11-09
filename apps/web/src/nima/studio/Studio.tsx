import { useNavigate } from "@tanstack/react-router";
import type { EnvironmentId, StudioArea } from "@t3tools/contracts";
import {
  ArrowLeft,
  Clapperboard,
  Captions,
  Film,
  Image,
  Layers,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Trash2,
  ChevronDown,
  PanelRightOpen,
} from "lucide-react";
import { useRef, useState } from "react";
import { StudioNavigationContext, type StudioLeaveGuard } from "./navigation";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { useStudio } from "./useStudio";
import { jsonRecord, type Catalog } from "./model";
import { StudioCanvas } from "./StudioCanvas";
import { StudioStory } from "./StudioStory";
import { StudioMotion } from "./StudioMotion";
import { StudioRecordings } from "./StudioRecordings";
import { StudioLive } from "./StudioLive";
import { StudioChoice } from "./Controls";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../../components/ui/menu";
import styles from "./Studio.module.css";

const areas = [
  { id: "design", name: "Design", icon: Layers },
  { id: "photo", name: "Photo", icon: Image },
  { id: "story", name: "Story", icon: Clapperboard },
  { id: "motion", name: "Motion", icon: Film },
  { id: "live", name: "Live", icon: Radio },
  { id: "recordings", name: "Recordings", icon: Captions },
] as const;
export function Studio({
  area = "design",
  id,
  environmentId,
  onOpen,
  onDock,
  embedded = false,
}: {
  area?: StudioArea;
  id?: string;
  environmentId?: EnvironmentId;
  onOpen?: (area: StudioArea, id?: string) => void;
  onDock?: () => void;
  embedded?: boolean;
}) {
  const session = useStudio({ scope: "studio" }, environmentId);
  const catalog = session.query.data?.data as Catalog | null | undefined;
  const trashed = new Set(catalog?.studio.trash?.assets ?? []);
  const selected = catalog?.studio.assets.find(
    (asset) => asset.id === id && !trashed.has(asset.id),
  );
  const workspaces = new Set(
    catalog?.studio.workspaces
      .filter((workspace) => workspace.kind === area)
      .map((workspace) => workspace.id),
  );
  const members = new Set(
    catalog?.studio.workspace_items
      .filter((item) => workspaces.has(item.workspace))
      .map((item) => item.asset),
  );
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const [preset, setPreset] = useState("poster");
  const leaveGuard = useRef<StudioLeaveGuard | null>(null);
  const [liveVisited, setLiveVisited] = useState(false);
  if (area === "live" && session.query.data?.available === true && !liveVisited)
    setLiveVisited(true);
  const navigate = useNavigate();
  const open = async (nextArea: StudioArea, nextId?: string) => {
    if (
      embedded &&
      (nextArea !== area || nextId !== id) &&
      leaveGuard.current &&
      !leaveGuard.current.mayLeave()
    )
      return;
    if (onOpen) return onOpen(nextArea, nextId);
    await navigate({
      to: "/studio",
      search: {
        area: nextArea,
        ...(nextId ? { id: nextId } : {}),
        ...(session.environmentId ? { environmentId: session.environmentId } : {}),
      },
    });
  };
  const create = async () => {
    const result = await session.write(
      "create",
      catalog?.revision ?? 0,
      area === "design" ? { preset } : {},
      { area },
    );
    if (
      result &&
      typeof result === "object" &&
      !Array.isArray(result) &&
      typeof jsonRecord(result).id === "string"
    )
      await open(
        area,
        jsonRecord(result).id === "live" ? undefined : (jsonRecord(result).id as string),
      );
  };
  const documents =
    catalog?.studio.assets.filter(
      (asset) =>
        members.has(asset.id) &&
        trashed.has(asset.id) === archived &&
        asset.name.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  return (
    <StudioNavigationContext
      value={{ guard: leaveGuard, environmentId: session.environmentId, area, id }}
    >
      <main className={`${styles.studio} @container/studio`} aria-label="Studio">
        <header className={styles.header}>
          <div className={styles.documentIdentity}>
            {id ? (
              <Button
                size="sm"
                variant="ghost"
                aria-label="Studio documents"
                onClick={() => void open(area)}
              >
                <ArrowLeft />
                <span className={styles.backLabel}>Studio</span>
              </Button>
            ) : (
              <h1 className="text-base font-semibold tracking-tight">Studio</h1>
            )}
            {selected && (
              <div className={styles.documentTitle}>
                <Input
                  size="sm"
                  key={selected.id + selected.name}
                  aria-label="Studio document name"
                  defaultValue={selected.name}
                  disabled={!session.canWrite || session.busy}
                  maxLength={200}
                  onBlur={(event) => {
                    const name = event.target.value.trim();
                    if (name && name !== selected.name)
                      void session.write("studio", catalog!.revision, {
                        type: "edit",
                        commands: [{ op: "rename_asset", id: selected.id, name }],
                      });
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                />
              </div>
            )}
          </div>
          <nav aria-label="Creative workspace">
            {onDock && (
              <Button
                size="sm"
                variant="ghost"
                onClick={onDock}
                aria-label="Open Studio beside chat"
              >
                <PanelRightOpen />
                <span className={styles.dockLabel}>Chat alongside</span>
              </Button>
            )}
            <Menu>
              <MenuTrigger
                render={
                  <Button size="sm" variant="secondary" aria-label="Switch creative workspace" />
                }
              >
                {areas.find((item) => item.id === area)?.name}
                <ChevronDown />
              </MenuTrigger>
              <MenuPopup align="end">
                {areas.map((item) => (
                  <MenuItem key={item.id} onClick={() => void open(item.id)}>
                    <item.icon /> {item.name}
                    {item.id === area && (
                      <span className="ms-auto text-xs text-muted-foreground">Current</span>
                    )}
                  </MenuItem>
                ))}
              </MenuPopup>
            </Menu>
          </nav>
        </header>
        {(session.error || session.query.error) && (
          <div
            role="alert"
            className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-3 text-sm text-destructive"
          >
            {session.error || session.query.error}
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                session.setError("");
                session.query.refresh();
              }}
            >
              Retry
            </Button>
          </div>
        )}
        {!session.connected && area !== "live" ? (
          <div className="m-auto p-8 text-sm text-muted-foreground" role="status">
            Connect to your Bara server to open Studio.
          </div>
        ) : session.query.isPending && !session.query.data ? (
          <div className="m-auto p-8 text-sm text-muted-foreground" role="status">
            Opening Studio…
          </div>
        ) : session.query.data?.available === false ? (
          <div className="m-auto max-w-lg space-y-4 p-8 text-sm text-muted-foreground">
            <h2 className="text-lg text-foreground">Connect the creative engine</h2>
            <p>{session.query.data.message}</p>
            <Button size="sm" variant="outline" onClick={session.query.refresh}>
              <RefreshCw />
              Check connection
            </Button>
          </div>
        ) : area === "recordings" ? (
          <StudioRecordings
            {...(id ? { id } : {})}
            {...(session.environmentId ? { environmentId: session.environmentId } : {})}
            onOpen={(id) => void open("recordings", id)}
          />
        ) : area === "live" ? null : selected?.content.type === "artwork" &&
          session.environmentId ? (
          <StudioCanvas
            key={`${session.environmentId}:${selected.id}`}
            environmentId={session.environmentId}
            asset={selected}
            area={area}
            catalog={session}
          />
        ) : selected?.content.type === "story" && catalog ? (
          <StudioStory
            key={`${session.environmentId}:${selected.id}`}
            asset={selected}
            catalog={catalog}
            session={session}
            onMotion={(id) => void open("motion", id)}
          />
        ) : selected?.content.type === "motion" && catalog ? (
          <StudioMotion
            key={`${session.environmentId}:${selected.id}`}
            asset={selected}
            catalog={catalog}
            session={session}
          />
        ) : id ? (
          <div className="m-auto p-8 text-sm text-muted-foreground">
            This document is unavailable. Open Studio to choose another.
          </div>
        ) : (
          <section className="min-h-0 flex-1 overflow-y-auto scrollbar-gutter-both">
            <div className={styles.library}>
              <header className="mb-7 flex items-start justify-between gap-4">
                <div>
                  <h2 className={styles.title}>{areas.find((item) => item.id === area)?.name}</h2>
                </div>
                {area !== "motion" && (
                  <div className="flex flex-wrap items-end gap-3">
                    {area === "design" && (
                      <div className="w-36">
                        <StudioChoice
                          label="Canvas preset"
                          value={preset}
                          options={[
                            { value: "poster", label: "Poster" },
                            { value: "app_screen", label: "App screen" },
                            { value: "web_page", label: "Web page" },
                          ]}
                          onChange={setPreset}
                          disabled={!session.canWrite || session.busy}
                        />
                      </div>
                    )}
                    <Button
                      size="sm"
                      disabled={!session.canWrite || session.busy}
                      onClick={() => void create()}
                    >
                      <Plus />
                      {session.busy
                        ? "Creating…"
                        : area === "story"
                          ? "New story"
                          : area === "photo"
                            ? "New photo"
                            : "New canvas"}
                    </Button>
                  </div>
                )}
              </header>
              <div className="mb-5 flex gap-1" role="group" aria-label="Studio document collection">
                <Button
                  size="xs"
                  variant={archived ? "ghost" : "secondary"}
                  aria-pressed={!archived}
                  onClick={() => setArchived(false)}
                >
                  Documents
                </Button>
                <Button
                  size="xs"
                  variant={archived ? "secondary" : "ghost"}
                  aria-pressed={archived}
                  onClick={() => setArchived(true)}
                >
                  Archived
                </Button>
              </div>
              {(documents.length > 0 || search) && (
                <div className="mb-6 max-w-sm">
                  <Input
                    aria-label="Find Studio documents"
                    placeholder="Find a document…"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
              )}
              <div className={styles.documents}>
                {documents.map((asset, index) => (
                  <article key={asset.id} className={styles.document}>
                    <button
                      disabled={archived}
                      className={styles.documentOpen}
                      onClick={() => void open(area, asset.id)}
                    >
                      <div className={styles.documentPreview}>
                        {asset.content.type === "artwork" && session.environmentId && index < 12 ? (
                          <ArtworkPreview id={asset.id} environmentId={session.environmentId} />
                        ) : asset.content.type === "story" ? (
                          <div className={styles.storyExcerpt}>
                            <Clapperboard size={19} strokeWidth={1.5} />
                            <p>{asset.content.story.premise || "A story waiting to unfold."}</p>
                            <small>{asset.content.story.scenes.length} scenes</small>
                          </div>
                        ) : asset.content.type === "motion" ? (
                          <div className={styles.storyExcerpt}>
                            <Film size={22} strokeWidth={1.5} />
                            <p>{asset.content.sequence.shots.length} shots</p>
                            <small>
                              {(
                                asset.content.sequence.shots.reduce(
                                  (sum, shot) => sum + shot.frames,
                                  0,
                                ) / 24
                              ).toFixed(1)}{" "}
                              seconds
                            </small>
                          </div>
                        ) : (
                          <Layers size={28} strokeWidth={1.5} />
                        )}
                      </div>
                      <span className={styles.documentName}>{asset.name}</span>
                    </button>
                    <div className="flex items-center justify-between gap-2 border-t border-border/50 px-3 py-2">
                      <span className="truncate text-xs text-muted-foreground">
                        {area === "photo"
                          ? "Photo composition"
                          : area === "story"
                            ? "Storyboard"
                            : area === "motion"
                              ? "Motion sequence"
                              : "Editable canvas"}
                      </span>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`${archived ? "Restore" : "Archive"} ${asset.name}`}
                        disabled={!session.canWrite || session.busy}
                        onClick={() =>
                          void session.write("studio", catalog!.revision, {
                            type: "edit",
                            commands: [
                              { op: archived ? "restore_asset" : "trash_asset", id: asset.id },
                            ],
                          })
                        }
                      >
                        {archived ? <RotateCcw /> : <Trash2 />}
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
              {!documents.length && (
                <div className="py-20 text-center">
                  <p className="text-base font-medium">
                    {archived
                      ? "No archived documents"
                      : search
                        ? "No matching documents"
                        : area === "motion"
                          ? "Start with a storyboard"
                          : "No documents"}
                  </p>
                  {area === "motion" && (
                    <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
                      Open a Story and choose Create motion to turn its shots into an editable
                      sequence.
                    </p>
                  )}
                </div>
              )}
            </div>
          </section>
        )}
        {liveVisited && (
          <div
            className={area === "live" ? "flex min-h-0 min-w-0 flex-1 flex-col" : "hidden"}
            inert={area !== "live"}
          >
            <StudioLive catalog={session} />
          </div>
        )}
      </main>
    </StudioNavigationContext>
  );
}

function ArtworkPreview({ id, environmentId }: { id: string; environmentId: EnvironmentId }) {
  const session = useStudio({ scope: "artwork", id }, environmentId);
  const svg = session.query.data?.svg;
  return svg ? (
    <img
      src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
      alt=""
      loading="lazy"
    />
  ) : (
    <Layers size={28} strokeWidth={1.5} />
  );
}
