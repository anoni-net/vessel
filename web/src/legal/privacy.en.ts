import type { LegalDoc } from "./types.ts";

export default {
  updated: "2026-10-28",
  blocks: [
    { p: "Vessel keeps only the data the service needs to run." },
    { h: "What we keep" },
    {
      table: {
        head: ["Data", "Purpose", "How long"],
        rows: [
          ["A hash of the account number (Argon2id), which cannot be turned back into the number", "Checking it at sign-in", "Until the account is deleted"],
          ["The account's creation date and the last day it used the portal (day only)", "Deciding when devices expire", "Until the account is deleted"],
          ["A hash of each invite code, the date it was redeemed and the account that redeemed it", "Making sure each code is used once", "The link to the account is removed when the account is deleted; the code's record is kept for now, and the final version will set a limit"],
          ["Each device's name, public key, city, tunnel IP address, DNS filter option and expiry date", "Letting the node recognize the device and listing it for you", "Until the device is deleted or expires"],
          ["The account's monthly traffic total", "Counting the allowance", "Until the account is deleted"],
          ["A hash of the sign-in session", "Keeping you signed in", "Until you sign out, or after 30 days without using the portal"],
        ],
      },
    },
    { p: "You choose the device names, so please avoid your real name or anything that identifies you." },
    { h: "What we do not keep" },
    {
      ul: [
        "Email addresses, phone numbers or any other contact details",
        "Device private keys. They are generated in your browser and never sent to our servers",
        "Which sites you visit, or when you connect",
        "Your IP address. Neither the portal nor the API keeps access logs",
        "DNS queries. The node's resolvers do not log them",
      ],
    },
    { h: "What a node handles while you are connected" },
    { p: "While you are connected, the node holds your current IP address in memory, since it needs it to send data back to you. It also handles the domains and IP addresses you connect to, but not the contents of HTTPS connections. This exists only in memory while you are connected, and is never written to disk or to any log." },
    { h: "DNS filtering" },
    { p: "When creating a device you can choose to block malicious sites and ads. Filtering happens on the node's resolver, which does not log what it blocks. Blocking malicious sites uses HaGeZi's Threat Intelligence Feeds (mini), and blocking ads adds HaGeZi Multi (Normal). The lists are updated every 8 hours and published on [HaGeZi's GitHub](https://github.com/hagezi/dns-blocklists)." },
    { h: "Statistics" },
    { p: "Views of public pages, and the result of each step of redeeming, signing in and creating a device, go to the Umami instance anoni.net hosts, so problems along the way show up. Each record holds only the page path, the language, the screen size rounded to hundreds and the step's result. Account numbers, device names and settings, and keys are never sent. Umami works out the country and city from the IP address but does not keep the address." },
    { p: "Nothing is sent when your browser has Do Not Track or Global Privacy Control turned on, and you can turn it off in the footer." },
    { h: "Third parties that handle data" },
    {
      ul: [
        "Cloudflare: the portal goes through Cloudflare, which can see visitors' IP addresses and the pages they view, under [Cloudflare's privacy policy](https://www.cloudflare.com/privacypolicy/). Cloudflare's analytics script is turned off for the portal. Cloudflare's Page Shield adds a reporting policy to a sample of pages, so the browser reports the scripts the page loads and the addresses it connects to back to Cloudflare, to detect injected malicious scripts. The reports hold addresses, not anything you type. VPN connections do not go through Cloudflare",
        "DigitalOcean: the nodes run on DigitalOcean servers. As the network provider it can see traffic in and out of the nodes, but cannot decrypt the connections",
        "Amazon SES: invite codes for the test are sent with the newsletter, so the mail service handles their contents. The list of which subscriber got which code is deleted after sending, so the portal's database cannot tell which account came from which subscriber",
      ],
    },
    { h: "Backups" },
    { p: "The database is backed up daily, and backups are kept for 14 days. Deleted data stays in backups for that period before it is gone. The key used to hash account numbers is stored separately from the database backups." },
    { h: "Requests from law enforcement" },
    { p: "We can only provide what is listed under “What we keep”. With no connection logs, we cannot trace an exit IP address and a time to an account." },
    { h: "Deleting your account" },
    { p: "You can delete your account at any time on the account page. The account, its devices, its monthly traffic and its sessions are deleted together, and copies in backups are gone within 14 days." },
    { h: "Changes to this policy" },
    { p: "We have no way to contact you, so changes are announced on the Vessel site and in the anoni.net newsletter." },
    { h: "Contact" },
    { p: "The anoni.net anonymous network community: [whisper@anoni.net](mailto:whisper@anoni.net)" },
  ],
} satisfies LegalDoc;
