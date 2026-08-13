import { describe, expect, it } from "vitest";
import {
  explorerTabContributionIds,
  explorerTabContributionQueryKinds,
  isExplorerTabContributionId,
} from "./explorer-tab-contribution-registry";

describe("Explorer tab contribution registry", () => {
  it("defines the fork-provided tabs and their query kinds", () => {
    expect(explorerTabContributionIds).toEqual(["repository_graph", "ci"]);
    expect(explorerTabContributionQueryKinds).toEqual(["repositoryGraph", "branchCiPipeline"]);
  });

  it("recognizes only registered contribution tabs", () => {
    expect(isExplorerTabContributionId("repository_graph")).toBe(true);
    expect(isExplorerTabContributionId("ci")).toBe(true);
    expect(isExplorerTabContributionId("changes")).toBe(false);
  });
});
