import { describe, expect, it } from "vitest";
import { getForgeDefinition } from "./forge-manifest.js";

describe("forge manifest overlays", () => {
  it("adds Iceveil's GitLab host and web authority without changing shared GitLab data", () => {
    expect(getForgeDefinition("gitlab")).toMatchObject({
      displayName: "GitLab",
      cloudHosts: ["gitlab.com", "gitlab.iceveil.com"],
      webAuthorities: { "gitlab.iceveil.com": "gitlab.iceveil.com:38443" },
    });
  });
});
