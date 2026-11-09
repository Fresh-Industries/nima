import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { Annotation, Compartment, EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap, placeholder as editorPlaceholder } from "@codemirror/view";
import { useLayoutEffect, useRef, useState } from "react";
import { useStableCallback } from "../hooks/useStableCallback";
import { liveMarkdown } from "./liveMarkdown";
import styles from "./LiveMarkdownEditor.module.css";

const externalUpdate = Annotation.define<boolean>();

const editorConfiguration = (
  readOnly: boolean,
  label: string,
  placeholder: string,
  maxLength: number,
) => [
  EditorState.readOnly.of(readOnly),
  EditorView.editable.of(!readOnly),
  EditorView.contentAttributes.of({
    "aria-label": label,
    "aria-multiline": "true",
    "aria-readonly": String(readOnly),
    role: "textbox",
    spellcheck: "true",
    tabindex: "0",
  }),
  editorPlaceholder(placeholder),
  EditorState.changeFilter.of(
    (transaction) => !transaction.docChanged || transaction.newDoc.length <= maxLength,
  ),
];

export function LiveMarkdownEditor({
  value,
  onChange,
  label,
  placeholder = "Start writing…",
  readOnly = false,
  maxLength,
  appearance = "notepad",
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  readOnly?: boolean;
  maxLength: number;
  appearance?: "notepad" | "document";
}) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const change = useStableCallback(onChange);
  const [configuration] = useState(() => new Compartment());
  const [initialValue] = useState(value);
  const settings = editorConfiguration(readOnly, label, placeholder, maxLength);
  const [initialSettings] = useState(settings);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns the imperative editor for this mounted document, preserving its selection, scroll and undo history
  useLayoutEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initialValue,
        extensions: [
          configuration.of(initialSettings),
          liveMarkdown,
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (
              update.docChanged &&
              !update.transactions.some((transaction) => transaction.annotation(externalUpdate))
            )
              change(update.state.doc.toString());
          }),
        ],
      }),
    });
    editor.current = view;
    return () => {
      editor.current = null;
      view.destroy();
    };
  }, [initialValue, initialSettings, configuration, change]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- updates permissions and accessibility on the existing editor without replacing the document
  useLayoutEffect(() => {
    editor.current?.dispatch({ effects: configuration.reconfigure(settings) });
  }, [configuration, settings]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- applies remote or recovered Markdown without echoing it as a local edit or discarding selection
  useLayoutEffect(() => {
    const view = editor.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    let from = 0;
    while (from < current.length && from < value.length && current[from] === value[from]) from++;
    let to = current.length;
    let end = value.length;
    while (to > from && end > from && current[to - 1] === value[end - 1]) {
      to--;
      end--;
    }
    view.dispatch({
      changes: { from, to, insert: value.slice(from, end) },
      annotations: [externalUpdate.of(true), Transaction.addToHistory.of(false)],
      filter: false,
    });
  }, [value]);

  return (
    <div
      ref={host}
      className={`${styles.root} ${appearance === "document" ? styles.document : ""}`}
    />
  );
}
