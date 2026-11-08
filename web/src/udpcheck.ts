// The UDP check on /check/: Vessel's nodes speak AmneziaWG over UDP, and a network that drops UDP cannot reach them. A page
// cannot send UDP itself; WebRTC can, to a STUN server (Cloudflare's public one, address from /api/network). It listens
// on 3478, not the nodes' 443: a network that lets only a few ports out can fail here and still reach Vessel. A server-reflexive
// ("srflx") candidate comes from the server's answer, so the packet went out and came back.
// That candidate carries the visitor's public address. Only its type is read here: the address is not shown, not kept,
// and not sent anywhere.

export type UdpResult = "pass" | "fail" | "unknown";

export const UDP_TIMEOUT_MS = 5000;

/** the candidate's type; older browsers only have it inside the candidate line */
function kind(candidate: RTCIceCandidate): string | undefined {
  return candidate.type ?? / typ (\w+)/.exec(candidate.candidate)?.[1];
}

export async function udpCheck(server: string): Promise<UdpResult> {
  if (typeof RTCPeerConnection === "undefined") return "unknown";
  let pc: RTCPeerConnection;
  try {
    pc = new RTCPeerConnection({ iceServers: [{ urls: `stun:${server}` }] });
  } catch {
    return "unknown";
  }
  try {
    return await new Promise<UdpResult>((resolve) => {
      let candidates = 0;
      let failed = false;
      const timer = setTimeout(() => resolve("fail"), UDP_TIMEOUT_MS);
      const done = (result: UdpResult) => {
        clearTimeout(timer);
        resolve(result);
      };
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          candidates++;
          if (kind(event.candidate) === "srflx") done("pass");
        } else {
          // gathering ended without an answer. No candidate at all: the browser keeps WebRTC from the network (a
          // privacy setting or an extension), which says nothing about the network
          done(candidates === 0 && !failed ? "unknown" : "fail");
        }
      };
      // the STUN server did not answer (701), where the browser reports it
      pc.addEventListener("icecandidateerror", () => {
        failed = true;
      });
      pc.createDataChannel("udp");
      pc.createOffer().then((offer) => pc.setLocalDescription(offer)).catch(() => done("unknown"));
    });
  } finally {
    pc.close();
  }
}
