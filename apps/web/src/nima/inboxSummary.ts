export function inboxSummary(markdown: string): string {
  const paragraphs = markdown
    .replace(/```[\s\S]*?(?:```|$)/g, "")
    .split(/\n\s*\n/)
    .map((part) =>
      part
        .split("\n")
        .filter((line) => !/^\s*(?:#{1,6}\s|[-*_]{3,}\s*$|\|)/.test(line))
        .map((line) => line.replace(/^\s*(?:>\s*|[-*+]\s+|\d+[.)]\s+)/, ""))
        .join(" ")
        .replace(/!?\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/\*\*|__|~~|`/g, "")
        .replace(/\*([^*\n]+)\*/g, "$1")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
  const first = paragraphs.find((part) => part.length > 45) ?? paragraphs[0] ?? "";
  const overview = first
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .slice(0, 2)
    .join(" ");
  if (overview.length <= 300) return overview;
  return (
    overview
      .slice(0, 297)
      .replace(/\s+\S*$/, "")
      .trimEnd() + "…"
  );
}
