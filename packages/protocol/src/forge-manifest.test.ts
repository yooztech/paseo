import { describe, expect, it } from "vitest";
import { getForgeDefinition, getForgeKnownHosts } from "./forge-manifest.js";

describe("forge manifest overlays", () => {
  it("adds a known self-hosted GitLab host without treating it as public cloud", () => {
    const gitlab = getForgeDefinition("gitlab");
    expect(gitlab).toMatchObject({
      displayName: "GitLab",
      cloudHosts: ["gitlab.com"],
      selfHostedHosts: ["gitlab.iceveil.com"],
      webAuthorities: { "gitlab.iceveil.com": "gitlab.iceveil.com:38443" },
    });
    expect(gitlab && getForgeKnownHosts(gitlab)).toEqual(["gitlab.com", "gitlab.iceveil.com"]);
  });
});
