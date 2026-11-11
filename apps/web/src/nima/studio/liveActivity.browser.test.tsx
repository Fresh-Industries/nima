import { EnvironmentId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { render } from "../../../test/render";
import { useLiveActivity, usePublishLiveActivity } from "./liveActivity";

function LiveSession({
  environmentId,
  recording = false,
  broadcast = false,
  capture = false,
}: {
  environmentId: EnvironmentId;
  recording?: boolean;
  broadcast?: boolean;
  capture?: boolean;
}) {
  usePublishLiveActivity(environmentId, recording, broadcast, capture);
  return null;
}

it("keeps elapsed time across source changes, resets after stopping, and cleans up only its host", async () => {
  useLiveActivity.setState({ hosts: {} });
  using now = vi.spyOn(Date, "now").mockReturnValue(1000);
  const environmentId = EnvironmentId.make("recording-host");
  const otherId = EnvironmentId.make("other-host");
  // This tests media-session ownership without routes or device capture.
  await using screen = await render(<LiveSession environmentId={environmentId} recording />, {
    router: false,
  });
  expect(useLiveActivity.getState().hosts[environmentId]?.since).toBe(1000);

  now.mockReturnValue(2000);
  await screen.rerender(<LiveSession environmentId={environmentId} recording capture />);
  expect(useLiveActivity.getState().hosts[environmentId]?.since).toBe(1000);
  await screen.rerender(<LiveSession environmentId={environmentId} recording broadcast />);
  expect(useLiveActivity.getState().hosts[environmentId]?.since).toBe(1000);
  await screen.rerender(<LiveSession environmentId={environmentId} broadcast />);
  expect(useLiveActivity.getState().hosts[environmentId]?.since).toBe(1000);

  await screen.rerender(<LiveSession environmentId={environmentId} capture />);
  expect(useLiveActivity.getState().hosts[environmentId]).toMatchObject({
    recording: false,
    broadcast: false,
    capture: true,
    since: null,
  });
  now.mockReturnValue(3000);
  await screen.rerender(<LiveSession environmentId={environmentId} recording />);
  expect(useLiveActivity.getState().hosts[environmentId]?.since).toBe(3000);

  await using other = await render(<LiveSession environmentId={otherId} broadcast />, {
    router: false, // The second mounted media session has no routes either.
  });
  await screen.unmount();
  expect(useLiveActivity.getState().hosts[environmentId]).toBeUndefined();
  expect(useLiveActivity.getState().hosts[otherId]).toMatchObject({ broadcast: true, since: 3000 });
  await other.unmount();
  expect(useLiveActivity.getState().hosts).toEqual({});
});
