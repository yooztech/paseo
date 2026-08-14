import type { ForgeManifestOverlay } from "../../forge-manifest.js";

/** Known self-hosted deployments with repository-specific web authorities. */
export const SELF_HOSTED_FORGE_MANIFEST_OVERLAY = {
  definitions: [
    {
      id: "gitlab",
      selfHostedHosts: ["gitlab.iceveil.com"],
      webAuthorities: { "gitlab.iceveil.com": "gitlab.iceveil.com:38443" },
    },
  ],
} as const satisfies ForgeManifestOverlay;
