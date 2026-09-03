import { describe, expect, it } from "vitest";
import { getForgeDefinition } from "../../forge-manifest.js";
import { getForkForgeKnownHosts, getForkForgeWebAuthority } from "./self-hosted.js";

describe("self-hosted forge overlay", () => {
  it("adds Iceveil without mutating the official GitLab definition", () => {
    const gitlab = getForgeDefinition("gitlab");
    expect(gitlab).toMatchObject({
      displayName: "GitLab",
      cloudHosts: ["gitlab.com"],
    });
    expect(gitlab && getForkForgeKnownHosts(gitlab)).toEqual(["gitlab.com", "gitlab.iceveil.com"]);
    expect(getForkForgeWebAuthority("gitlab", "gitlab.iceveil.com")).toBe(
      "gitlab.iceveil.com:38443",
    );
  });
});
