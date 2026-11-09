export type WhipPublisher = { stop: () => Promise<void> };
export function whipEndpoint(endpoint: string): URL {
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Use your provider’s HTTPS WHIP endpoint.");
  return url;
}
export function whipResource(endpoint: URL, location: string): URL {
  const resource = new URL(location, endpoint);
  if (resource.origin !== endpoint.origin || resource.username || resource.password)
    throw new Error("The broadcast destination returned an invalid session location.");
  return resource;
}
export async function publishWhip(
  stream: MediaStream,
  endpoint: string,
  token: string,
  signal: AbortSignal,
  onState: (state: RTCPeerConnectionState) => void,
): Promise<WhipPublisher> {
  let ownedPeer: RTCPeerConnection | null = null;
  let resource: URL | null = null;
  const close = () => {
    ownedPeer?.close();
    for (const track of stream.getTracks()) track.stop();
  };
  signal.addEventListener("abort", close, { once: true });
  try {
    const url = whipEndpoint(endpoint);
    if (/[\r\n]/.test(token) || token.length > 8192)
      throw new Error("The broadcast token is invalid.");
    if (signal.aborted) throw new Error("Broadcast connection cancelled.");
    const peer = new RTCPeerConnection();
    ownedPeer = peer;
    peer.addEventListener("connectionstatechange", () => onState(peer.connectionState));
    for (const track of stream.getTracks())
      peer.addTransceiver(track, { direction: "sendonly", streams: [stream] });
    await peer.setLocalDescription(await peer.createOffer());
    if (peer.iceGatheringState !== "complete")
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(
          () => finish(new Error("The browser could not prepare a broadcast connection.")),
          15_000,
        );
        const changed = () => {
          if (peer.iceGatheringState === "complete") finish();
        };
        const aborted = () => finish(new Error("Broadcast connection cancelled."));
        const finish = (error?: Error) => {
          window.clearTimeout(timeout);
          peer.removeEventListener("icegatheringstatechange", changed);
          signal.removeEventListener("abort", aborted);
          if (error) reject(error);
          else resolve();
        };
        peer.addEventListener("icegatheringstatechange", changed);
        signal.addEventListener("abort", aborted, { once: true });
        changed();
      });
    if (signal.aborted) throw new Error("Broadcast connection cancelled.");
    const headers: Record<string, string> = { "Content-Type": "application/sdp" };
    if (token.trim()) headers.Authorization = `Bearer ${token.trim()}`;
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: peer.localDescription!.sdp,
      signal,
      credentials: "omit",
      redirect: "error",
    });
    if (!response.ok)
      throw new Error(`The broadcast destination returned HTTP ${response.status}.`);
    const location = response.headers.get("Location");
    if (location) {
      resource = whipResource(url, location);
    }
    await peer.setRemoteDescription({ type: "answer", sdp: await response.text() });
    if (signal.aborted) throw new Error("Broadcast connection cancelled.");
    return {
      stop: async () => {
        signal.removeEventListener("abort", close);
        close();
        if (resource) {
          const headers: Record<string, string> = {};
          if (token.trim()) headers.Authorization = `Bearer ${token.trim()}`;
          await fetch(resource, {
            method: "DELETE",
            headers,
            credentials: "omit",
            redirect: "error",
            signal: AbortSignal.timeout(5000),
          });
        }
      },
    };
  } catch (error) {
    signal.removeEventListener("abort", close);
    close();
    throw error;
  }
}
