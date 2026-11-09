import { expect, it } from "vite-plus/test";
import { whipEndpoint, whipResource, publishWhip } from "./whip";
it("keeps broadcast cleanup on the authenticated destination and rejects embedded credentials", () => {
  const endpoint = whipEndpoint("https://stream.example/live/input");
  expect(whipResource(endpoint, "../sessions/session-one").href).toBe(
    "https://stream.example/sessions/session-one",
  );
  for (const location of [
    "https://other.example/session",
    "//other.example/session",
    "https://user:password@stream.example/session",
    "http://stream.example/session",
  ])
    expect(() => whipResource(endpoint, location)).toThrow();
  for (const input of [
    "http://stream.example/live",
    "https://user:password@stream.example/live",
    "file:///tmp/stream",
  ])
    expect(() => whipEndpoint(input)).toThrow();
});
it("releases the owned program tracks when setup fails before a peer can be created", async () => {
  let stops = 0;
  const stream = {
    getTracks: () => [
      {
        stop: () => {
          stops++;
        },
      },
    ],
  } as unknown as MediaStream;
  await expect(
    publishWhip(stream, "http://stream.example/live", "", new AbortController().signal, () => {}),
  ).rejects.toThrow();
  expect(stops).toBe(1);
});
