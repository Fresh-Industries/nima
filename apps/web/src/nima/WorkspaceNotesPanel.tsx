import { WORKSPACE_NOTE_MAX_LENGTH } from "@t3tools/contracts";
import { LiveMarkdownEditor } from "./LiveMarkdownEditor";
import { useWorkspaceNotes } from "./useWorkspaceNotes";
import styles from "./nima.module.css";

export function WorkspaceNotesPanel() {
  const notes = useWorkspaceNotes();
  return (
    <div className={styles["bara-notes"]}>
      <div className={styles["bara-notes-toolbar"]}>
        <span>Live preview</span>
        <span>Markdown</span>
      </div>
      <div className={styles["bara-notes-editor"]}>
        <LiveMarkdownEditor
          label="Workspace notes"
          placeholder="Write a note"
          value={notes.draft.markdown}
          maxLength={WORKSPACE_NOTE_MAX_LENGTH}
          readOnly={!notes.canEdit}
          onChange={notes.edit}
        />
      </div>
      {notes.conflict && (
        <div className={styles["bara-notes-conflict"]} role="alert">
          <p>Another browser or agent changed these notes. Your draft has been kept.</p>
          <details>
            <summary>View server version</summary>
            <pre>{notes.remote?.markdown}</pre>
          </details>
          <div>
            <button onClick={notes.useServerVersion}>Use server version</button>
            <button onClick={notes.keepDraft}>Keep my version</button>
          </div>
        </div>
      )}
      <div className={styles["bara-notes-status"]}>
        <span role="status" aria-live="polite">
          {notes.status}
        </span>
        {!notes.saving && !notes.conflict && ((notes.dirty && notes.canSave) || notes.canRetry) && (
          <button onClick={notes.retry}>{notes.canRetry ? "Retry" : "Save now"}</button>
        )}
      </div>
    </div>
  );
}
