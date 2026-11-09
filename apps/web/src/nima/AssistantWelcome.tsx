import { usePersonalAssistant } from "./usePersonalAssistant";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, FileText, PenLine, Search, Shapes } from "lucide-react";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";
import styles from "./WorkspaceHome.module.css";
import { inboxSummary } from "./inboxSummary";

export function AssistantWelcome() {
  const {
    config: { name, avatar },
  } = usePersonalAssistant();
  return (
    <div className={styles.welcome}>
      <h1>
        <span aria-hidden="true">{avatar}</span>
        {name}
      </h1>
    </div>
  );
}

export function AssistantStartActions({
  onPrompt,
  hasDraft,
}: {
  onPrompt: (prompt: string) => void;
  hasDraft: boolean;
}) {
  const { environmentId } = usePersonalAssistant();
  const library = useEnvironmentQuery(
    environmentId
      ? serverEnvironment.workspacePagesLive({ environmentId, input: { archived: false } })
      : null,
  );
  const recent = library.data?.pages.slice(0, 2) ?? [];
  return (
    <div className={styles.belowComposer}>
      {!hasDraft && (
        <div className={styles.suggestions} aria-label="Suggested actions">
          <button onClick={() => onPrompt("Help me write ")}>
            <PenLine size={16} strokeWidth={1.5} /> Write
          </button>
          <button onClick={() => onPrompt("Help me research ")}>
            <Search size={16} strokeWidth={1.5} /> Research
          </button>
          <Link to="/studio" search={{ area: "design" }}>
            <Shapes size={16} strokeWidth={1.5} /> Studio
          </Link>
        </div>
      )}
      {recent.length > 0 && (
        <section className={styles.recent} aria-label="Recent documents">
          <header>
            <h2>Recent</h2>
            <Link to="/spaces">
              Library <ArrowUpRight size={13} />
            </Link>
          </header>
          <div className={styles.documents}>
            {recent.map((page) => (
              <Link
                key={page.id}
                to="/spaces"
                search={{ environmentId: environmentId!, pageId: page.id }}
              >
                <FileText size={18} strokeWidth={1.4} />
                <span>
                  <strong>{page.title}</strong>
                  {page.excerpt && <small>{inboxSummary(page.excerpt)}</small>}
                </span>
                <ArrowUpRight size={14} />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
