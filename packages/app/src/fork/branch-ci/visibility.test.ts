import { describe, expect, it } from "vitest";
import { shouldShowBranchCiTab } from "./visibility";

const visiblePipeline = {
  hasPullRequest: false,
  prLoading: false,
  forgeBranchPipelineEnabled: true,
  prForge: "gitlab" as const,
  activeTab: "changes",
  supported: true,
  isLoading: false,
  hasPipeline: true,
};

describe("Branch CI tab visibility", () => {
  it("shows an available GitLab branch pipeline", () => {
    expect(shouldShowBranchCiTab(visiblePipeline)).toBe(true);
  });

  it("keeps a supported persisted CI tab visible while its pipeline is empty", () => {
    expect(
      shouldShowBranchCiTab({
        ...visiblePipeline,
        prForge: "github",
        activeTab: "ci",
        hasPipeline: false,
      }),
    ).toBe(true);
  });

  it("hides a persisted CI tab when branch pipeline RPCs are unavailable", () => {
    expect(
      shouldShowBranchCiTab({
        ...visiblePipeline,
        activeTab: "ci",
        forgeBranchPipelineEnabled: false,
      }),
    ).toBe(false);
  });

  it("hides branch CI while a pull request owns the pipeline view", () => {
    expect(shouldShowBranchCiTab({ ...visiblePipeline, hasPullRequest: true })).toBe(false);
  });

  it("hides an empty inactive branch CI tab after loading", () => {
    expect(shouldShowBranchCiTab({ ...visiblePipeline, hasPipeline: false })).toBe(false);
  });
});
