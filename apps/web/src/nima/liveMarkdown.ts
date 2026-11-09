import { markdown, markdownKeymap } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  EditorState,
  StateEffect,
  StateField,
  type Range,
} from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap, type DecorationSet } from "@codemirror/view";
import { GFM, parser } from "@lezer/markdown";

const focusChanged = StateEffect.define<boolean>();
const tableParser = parser.configure(GFM);
type MarkdownNode = ReturnType<typeof tableParser.parse>["topNode"];

function safeLink(source: string): string | null {
  try {
    const url = new URL(source, window.location.href);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function reveal(view: EditorView, position: number) {
  if (view.state.readOnly) return;
  view.dispatch({ selection: { anchor: position }, effects: focusChanged.of(true) });
  view.focus();
}

class BulletWidget extends WidgetType {
  override eq() {
    return true;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "bara-md-bullet";
    span.textContent = "•";
    span.setAttribute("aria-hidden", "true");
    return span;
  }
}

class TaskWidget extends WidgetType {
  constructor(
    readonly position: number,
    readonly checked: boolean,
    readonly readOnly: boolean,
  ) {
    super();
  }
  override eq(other: TaskWidget) {
    return (
      this.position === other.position &&
      this.checked === other.checked &&
      this.readOnly === other.readOnly
    );
  }
  toDOM(view: EditorView) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "bara-md-task";
    input.checked = this.checked;
    input.disabled = this.readOnly;
    input.setAttribute("aria-label", "Complete task");
    input.addEventListener("change", () => {
      if (!view.state.readOnly)
        view.dispatch({
          changes: {
            from: this.position + 1,
            to: this.position + 2,
            insert: input.checked ? "x" : " ",
          },
          userEvent: "input.task",
        });
    });
    return input;
  }
  override ignoreEvent() {
    return true;
  }
}

const INLINE_CLASSES: Readonly<Record<string, string>> = {
  StrongEmphasis: "bara-md-strong",
  Emphasis: "bara-md-emphasis",
  InlineCode: "bara-md-inline-code",
  Strikethrough: "bara-md-strike",
};
const INLINE_TAGS: Readonly<Record<string, string>> = {
  StrongEmphasis: "strong",
  Emphasis: "em",
  InlineCode: "code",
  Strikethrough: "s",
};
function appendInline(parent: HTMLElement, node: MarkdownNode, source: string) {
  let position = node.from;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    parent.append(document.createTextNode(source.slice(position, child.from)));
    if (!["EmphasisMark", "CodeMark", "StrikethroughMark"].includes(child.name)) {
      const tag = INLINE_TAGS[child.name];
      if (tag) {
        const element = document.createElement(tag);
        appendInline(element, child, source);
        parent.append(element);
      } else parent.append(document.createTextNode(source.slice(child.from, child.to)));
    }
    position = child.to;
  }
  parent.append(document.createTextNode(source.slice(position, node.to)));
}

class TableWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly position: number,
  ) {
    super();
  }
  override eq(other: TableWidget) {
    return this.source === other.source && this.position === other.position;
  }
  toDOM(view: EditorView) {
    const wrapper = document.createElement("div");
    wrapper.className = "bara-md-table";
    const table = document.createElement("table");
    const body = document.createElement("tbody");
    const node = tableParser.parse(this.source).topNode.firstChild;
    for (let row = node?.firstChild; row; row = row.nextSibling) {
      if (row.name !== "TableHeader" && row.name !== "TableRow") continue;
      const tr = document.createElement("tr");
      for (let cell = row.firstChild; cell; cell = cell.nextSibling) {
        if (cell.name !== "TableCell") continue;
        const td = document.createElement(row.name === "TableHeader" ? "th" : "td");
        td.dataset.sourcePosition = String(this.position + cell.from);
        appendInline(td, cell, this.source);
        tr.append(td);
      }
      body.append(tr);
    }
    table.append(body);
    wrapper.append(table);
    wrapper.addEventListener("mousedown", (event) => {
      if (view.state.readOnly || event.button !== 0) return;
      const cell =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>("[data-source-position]")
          : null;
      event.preventDefault();
      reveal(view, cell ? Number(cell.dataset.sourcePosition) : this.position);
    });
    return wrapper;
  }
  override ignoreEvent() {
    return true;
  }
}

class RuleWidget extends WidgetType {
  constructor(readonly position: number) {
    super();
  }
  override eq(other: RuleWidget) {
    return this.position === other.position;
  }
  toDOM(view: EditorView) {
    const hr = document.createElement("hr");
    hr.className = "bara-md-rule";
    hr.addEventListener("mousedown", (event) => {
      if (!view.state.readOnly) {
        event.preventDefault();
        reveal(view, this.position);
      }
    });
    return hr;
  }
  override ignoreEvent() {
    return true;
  }
}

function decorations(state: EditorState, focused: boolean): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const editing = (from: number, to: number) =>
    focused &&
    !state.readOnly &&
    state.selection.ranges.some((range) => range.from <= to && range.to >= from);
  const activeLine = (position: number) => {
    const line = state.doc.lineAt(position);
    return editing(line.from, line.to);
  };
  const hide = (from: number, to: number) => {
    if (to > from) ranges.push(Decoration.replace({}).range(from, to));
  };
  const mark = (from: number, to: number, className: string) => {
    if (to > from) ranges.push(Decoration.mark({ class: className }).range(from, to));
  };
  syntaxTree(state).iterate({
    enter(node) {
      const { from, to, name } = node;
      if (name === "Table" && !editing(from, to)) {
        ranges.push(
          Decoration.replace({
            widget: new TableWidget(state.doc.sliceString(from, to), from),
            block: true,
          }).range(from, to),
        );
        return false;
      }
      if (name === "HorizontalRule" && !activeLine(from)) {
        ranges.push(
          Decoration.replace({ widget: new RuleWidget(from), block: true }).range(from, to),
        );
        return false;
      }
      if (/^(ATX|Setext)Heading\d$/.test(name)) {
        const level = name.slice(-1);
        ranges.push(
          Decoration.line({
            class: `bara-md-heading bara-md-heading-${level}`,
            attributes: { role: "heading", "aria-level": level },
          }).range(state.doc.lineAt(from).from),
        );
      }
      if (name === "HeaderMark" && !activeLine(from)) {
        const end = state.doc.sliceString(to, to + 1) === " " ? to + 1 : to;
        hide(from, end);
      }
      const inline = INLINE_CLASSES[name];
      if (inline) mark(from, to, inline);
      if (
        ["EmphasisMark", "StrikethroughMark"].includes(name) ||
        (name === "CodeMark" && node.node.parent?.name === "InlineCode")
      ) {
        if (activeLine(from)) mark(from, to, "bara-md-syntax");
        else hide(from, to);
      }
      if (name === "Link") {
        const children: MarkdownNode[] = [];
        for (let child = node.node.firstChild; child; child = child.nextSibling)
          children.push(child);
        const close = children.find(
          (child) =>
            child.name === "LinkMark" && state.doc.sliceString(child.from, child.to) === "]",
        );
        const url = children.find((child) => child.name === "URL");
        const href = url ? safeLink(state.doc.sliceString(url.from, url.to)) : null;
        if (close && href && close.from > from + 1) {
          ranges.push(
            Decoration.mark({
              class: "bara-md-link",
              attributes: { "data-bara-md-href": href, title: "Ctrl/⌘-click to open link" },
            }).range(from + 1, close.from),
          );
          if (!activeLine(from)) {
            hide(from, from + 1);
            hide(close.from, to);
          }
        }
      }
      if (name === "ListMark" && !activeLine(from)) {
        const task = node.node.parent?.getChild("Task");
        const end = state.doc.sliceString(to, to + 1) === " " ? to + 1 : to;
        if (task) hide(from, end);
        else if (/^[-+*]$/.test(state.doc.sliceString(from, to)))
          ranges.push(Decoration.replace({ widget: new BulletWidget() }).range(from, end));
      }
      if (name === "TaskMarker" && !activeLine(from)) {
        ranges.push(
          Decoration.replace({
            widget: new TaskWidget(
              from,
              /[xX]/.test(state.doc.sliceString(from, to)),
              state.readOnly,
            ),
          }).range(from, to),
        );
        return false;
      }
      if (name === "QuoteMark") {
        ranges.push(Decoration.line({ class: "bara-md-quote" }).range(state.doc.lineAt(from).from));
        if (!activeLine(from)) hide(from, state.doc.sliceString(to, to + 1) === " " ? to + 1 : to);
      }
      if (name === "FencedCode" || name === "IndentedCode") {
        for (
          let line = state.doc.lineAt(from);
          line.from <= to;
          line = state.doc.line(line.number + 1)
        ) {
          ranges.push(Decoration.line({ class: "bara-md-code-line" }).range(line.from));
          if (line.number === state.doc.lines) break;
        }
      }
      if (
        name === "CodeMark" &&
        node.node.parent?.name === "FencedCode" &&
        !editing(node.node.parent.from, node.node.parent.to)
      )
        hide(from, to);
    },
  });
  return Decoration.set(ranges, true);
}

const livePreview = StateField.define<{ focused: boolean; decorations: DecorationSet }>({
  create: (state) => ({ focused: false, decorations: decorations(state, false) }),
  update(previous, transaction) {
    const focused = transaction.effects.find((effect) => effect.is(focusChanged))?.value as
      | boolean
      | undefined;
    const nextFocus = focused ?? previous.focused;
    if (
      !transaction.docChanged &&
      !transaction.selection &&
      focused === undefined &&
      syntaxTree(transaction.startState) === syntaxTree(transaction.state) &&
      transaction.startState.readOnly === transaction.state.readOnly
    )
      return previous;
    return { focused: nextFocus, decorations: decorations(transaction.state, nextFocus) };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

function wrapSelection(marker: string) {
  return (view: EditorView) => {
    if (view.state.readOnly) return false;
    const { from, to } = view.state.selection.main;
    const wrapped =
      from >= marker.length &&
      view.state.doc.sliceString(from - marker.length, from) === marker &&
      view.state.doc.sliceString(to, to + marker.length) === marker;
    view.dispatch({
      changes: wrapped
        ? [
            { from: from - marker.length, to: from, insert: "" },
            { from: to, to: to + marker.length, insert: "" },
          ]
        : { from, to, insert: marker + view.state.doc.sliceString(from, to) + marker },
      selection: EditorSelection.range(
        wrapped ? from - marker.length : from + marker.length,
        wrapped ? to - marker.length : to + marker.length,
      ),
      userEvent: "input.format",
    });
    return true;
  };
}

export const liveMarkdown = [
  markdown({ extensions: GFM }),
  livePreview,
  keymap.of([
    { key: "Mod-b", run: wrapSelection("**") },
    { key: "Mod-i", run: wrapSelection("*") },
    ...markdownKeymap,
  ]),
  EditorView.domEventHandlers({
    focus: (_event, view) => {
      view.dispatch({ effects: focusChanged.of(true) });
    },
    blur: (_event, view) => {
      view.dispatch({ effects: focusChanged.of(false) });
    },
    click: (event) => {
      const href =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>("[data-bara-md-href]")?.dataset.baraMdHref
          : null;
      if (href && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        window.open(href, "_blank", "noopener,noreferrer");
        return true;
      }
      return false;
    },
  }),
];
