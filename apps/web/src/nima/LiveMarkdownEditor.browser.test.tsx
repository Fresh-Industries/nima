import { EditorView } from "@codemirror/view";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { act, render, type Screen } from "../../test/render";
import { LiveMarkdownEditor } from "./LiveMarkdownEditor";

function view(screen: Screen) {
  return EditorView.findFromDOM(screen.container.querySelector(".cm-editor")!)!;
}

it("renders Markdown without changing its source, toggles tasks and exposes tables for editing", async () => {
  const source =
    "# Field guide\n\nA **clear** plan with _room_ to think and `code`. [](https://example.org) [unsafe](javascript:alert(1))\n\n- [ ] Draft\n\n| Step | State |\n| --- | --- |\n| **Outline** | Ready |\n\n```ts\nconst x = '<script>';\n```\n\n<img src=x onerror=alert(1)>";
  const onChange = vi.fn();
  await using screen = await render(
    <>
      <LiveMarkdownEditor value={source} onChange={onChange} label="Notes" maxLength={200000} />
      <button>Outside</button>
    </>,
  );
  expect(view(screen).state.doc.toString()).toBe(source);
  expect(screen.container.querySelector(".bara-md-heading")?.textContent).toBe("Field guide");
  expect(screen.container.querySelector(".bara-md-strong")?.textContent).toBe("clear");
  await expect.element(screen.getByRole("cell", { name: "Outline" })).toBeVisible();
  expect(screen.container.querySelector("img[onerror], script")).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.container.querySelector('[data-bara-md-href^="javascript:"]')).toBeNull();
  await screen.getByRole("checkbox", { name: "Complete task" }).click();
  expect(view(screen).state.doc.toString()).toBe(source.replace("[ ]", "[x]"));
  expect(onChange).toHaveBeenLastCalledWith(source.replace("[ ]", "[x]"));
  await screen.getByRole("cell", { name: "Outline" }).click();
  await expect.element(screen.getByRole("table")).not.toBeInTheDocument();
  expect(view(screen).state.selection.main.head).toBeGreaterThan(source.indexOf("| Step"));
  await screen.getByRole("button", { name: "Outside" }).click();
  await expect.element(screen.getByRole("table")).toBeVisible();
  expect(view(screen).state.doc.toString()).toBe(source.replace("[ ]", "[x]"));
});

it("renders typed headings and formatting automatically and keeps formatting undoable", async () => {
  const onChange = vi.fn();
  await using screen = await render(
    <>
      <LiveMarkdownEditor value="" onChange={onChange} label="Notes" maxLength={200000} />
      <button>Outside</button>
    </>,
  );
  await userEvent.click(screen.getByRole("textbox", { name: "Notes" }));
  await userEvent.type(screen.getByRole("textbox", { name: "Notes" }), "# A heading");
  await userEvent.keyboard("{Enter}{Enter}");
  await userEvent.type(screen.getByRole("textbox", { name: "Notes" }), "A small step");
  const editor = view(screen);
  const source = editor.state.doc.toString();
  expect(source).toBe("# A heading\n\nA small step");
  await act(() => {
    editor.dispatch({
      selection: { anchor: source.indexOf("small"), head: source.indexOf("small") + 5 },
    });
  });
  await userEvent.keyboard("{Control>}b{/Control}");
  expect(editor.state.doc.toString()).toBe(source.replace("small", "**small**"));
  await userEvent.keyboard("{Control>}z{/Control}");
  expect(editor.state.doc.toString()).toBe(source);
  await userEvent.type(screen.getByRole("textbox", { name: "Notes" }), "**better**");
  await screen.getByRole("button", { name: "Outside" }).click();
  expect(screen.container.querySelector(".bara-md-heading")?.textContent).toBe("A heading");
  expect(screen.container.querySelector(".bara-md-strong")?.textContent).toBe("better");
  expect(editor.state.doc.toString()).toContain("**better**");
});

it("accepts remote Markdown without echoing it or replacing the focused editor, and enforces read-only", async () => {
  const onChange = vi.fn();
  const source = "# Notes\n\nMy draft";
  await using screen = await render(
    <LiveMarkdownEditor value={source} onChange={onChange} label="Notes" maxLength={200000} />,
  );
  const editor = view(screen);
  await act(() => {
    editor.focus();
    editor.dispatch({ selection: { anchor: source.length } });
  });
  const remote = source + "\n\nUpdated by the agent.";
  await screen.rerender(
    <LiveMarkdownEditor value={remote} onChange={onChange} label="Notes" maxLength={200000} />,
  );
  expect(view(screen)).toBe(editor);
  expect(editor.state.selection.main.head).toBe(source.length);
  expect(editor.state.doc.toString()).toBe(remote);
  expect(onChange).not.toHaveBeenCalled();
  await screen.rerender(
    <LiveMarkdownEditor
      value={remote}
      onChange={onChange}
      label="Notes"
      maxLength={200000}
      readOnly
    />,
  );
  await userEvent.keyboard("x");
  expect(editor.state.doc.toString()).toBe(remote);
  await expect
    .element(screen.getByRole("textbox", { name: "Notes" }))
    .toHaveAttribute("aria-readonly", "true");
  await screen.rerender(
    <LiveMarkdownEditor value={remote} onChange={onChange} label="Notes" maxLength={200000} />,
  );
  await userEvent.click(screen.getByRole("textbox", { name: "Notes" }));
  await userEvent.keyboard("{Control>}{End}{/Control}");
  await userEvent.type(screen.getByRole("textbox", { name: "Notes" }), " More.");
  expect(editor.state.doc.toString()).toContain("Updated by the agent.");
  expect(onChange).toHaveBeenLastCalledWith(editor.state.doc.toString());
});

it("bounds typing without truncating the existing document", async () => {
  const onChange = vi.fn();
  await using screen = await render(
    <LiveMarkdownEditor value="Keep this" onChange={onChange} label="Notes" maxLength={12} />,
  );
  await userEvent.click(screen.getByRole("textbox", { name: "Notes" }));
  await userEvent.keyboard("{Control>}{End}{/Control}");
  await userEvent.type(screen.getByRole("textbox", { name: "Notes" }), "123456789");
  expect(view(screen).state.doc.toString()).toBe("Keep this123");
  expect(onChange.mock.calls.every(([value]) => value.length <= 12)).toBe(true);
});
