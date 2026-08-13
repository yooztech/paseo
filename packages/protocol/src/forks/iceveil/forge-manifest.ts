import type { ForgeManifestOverlay } from "../../forge-manifest.js";

/** Iceveil's GitLab deployment keeps SSH and browser traffic on separate ports. */
export const ICEVEIL_FORGE_MANIFEST_OVERLAY = {
  definitions: [
    {
      id: "gitlab",
      cloudHosts: ["gitlab.iceveil.com"],
      webAuthorities: { "gitlab.iceveil.com": "gitlab.iceveil.com:38443" },
    },
  ],
} as const satisfies ForgeManifestOverlay;
