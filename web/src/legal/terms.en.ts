import type { LegalDoc } from "./types.ts";

export default {
  updated: "2026-10-28",
  blocks: [
    { h: "The service" },
    { p: "Vessel is a free VPN set up by the anoni.net anonymous network community and run by volunteers, made up of the portal (vessel.anoni.net) and nodes in several cities. It is in testing: no network is guaranteed to work, and the service may be interrupted. We may change the allowance, nodes and features, or end the service, and will try to announce changes in advance." },
    { h: "Accounts" },
    { p: "Your account number is your sign-in credential, so keep it safe. A lost number cannot be recovered, and we have no email address to reset it with." },
    { p: "Each invite code creates one account. Invite codes and accounts must not be sold or traded for money." },
    { h: "Prohibited uses" },
    { p: "When using Vessel, do not:" },
    {
      ul: [
        "Break the law where you are or where the node is",
        "Attack, scan or access other systems without authorization",
        "Send spam or large volumes of unsolicited messages",
        "Spread malware or host phishing sites",
        "Use BitTorrent or other P2P file sharing during the test",
      ],
    },
    { p: "Nodes block outgoing TCP port 25, so mail cannot be sent straight to a mail server." },
    { h: "Allowance and expiry" },
    {
      ul: [
        "50 GB per account per month, shared by its devices and paused until the next month once used up",
        "Up to 3 devices per account",
        "Even if you stay connected, devices expire when the account has not opened the portal for 30 days; signing in, or opening the portal while signed in, extends them by 30 days",
      ],
    },
    { h: "We cannot trace individual accounts" },
    { p: "Vessel does not log where you connect or when. An abuse report usually gives only an exit IP address and a time, which we cannot trace to an account, so we can only respond with service-wide limits such as blocking certain ports or domains. A request from law enforcement can only get the data listed in the [privacy policy](/privacy/)." },
    { h: "Revocation and termination" },
    { p: "If an account breaks these terms, we may revoke its devices or disable it. You can delete your account at any time on the account page, which revokes all its devices." },
    { h: "Disclaimer" },
    { p: "Vessel is provided as is. To the extent the law allows, we are not liable for interruptions, failed connections, or losses from your use of Vessel. Vessel does not make you anonymous; use [Tor Browser](https://www.torproject.org/) when you need anonymity." },
    { h: "Changes to these terms" },
    { p: "We have no way to contact you, so changes are announced on the Vessel site and in the anoni.net newsletter. Continuing to use Vessel after a change takes effect means you accept the new terms." },
    { h: "Contact" },
    { p: "The anoni.net anonymous network community: [whisper@anoni.net](mailto:whisper@anoni.net)" },
  ],
} satisfies LegalDoc;
