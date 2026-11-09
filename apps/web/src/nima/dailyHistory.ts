export function dailyTimeline<T extends { createdAt: string }>(
  entries: ReadonlyArray<T>,
  from: string,
  timezone: string,
) {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const visible: T[] = [];
  let previous: string | null = null;
  let oldest: string | null = null;
  for (const entry of entries) {
    const parts = date.formatToParts(new Date(entry.createdAt));
    const day = ["year", "month", "day"]
      .map((type) => parts.find((part) => part.type === type)?.value)
      .join("-");
    if (day >= from) visible.push(entry);
    else if (previous === null || day > previous) previous = day;
    if (oldest === null || day < oldest) oldest = day;
  }
  return { entries: visible, previous, oldest };
}

export function timelineDayLabels(
  rows: ReadonlyArray<{ id: string; createdAt: string | null }>,
  timezone: string,
  today: string,
) {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const label = new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    weekday: "long",
    month: "short",
    day: "numeric",
  });
  const labels = new Map<string, string>();
  let previous: string | null = null;
  for (const row of rows) {
    if (!row.createdAt) continue;
    const timestamp = new Date(row.createdAt);
    const parts = date.formatToParts(timestamp);
    const day = ["year", "month", "day"]
      .map((type) => parts.find((part) => part.type === type)?.value)
      .join("-");
    if (day !== previous) labels.set(row.id, day === today ? "Today" : label.format(timestamp));
    previous = day;
  }
  return labels;
}
