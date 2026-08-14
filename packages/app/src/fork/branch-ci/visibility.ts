import type { Forge } from "@/git/forge";

interface BranchCiTabVisibilityInput {
  hasPullRequest: boolean;
  prLoading: boolean;
  forgeBranchPipelineEnabled: boolean;
  prForge: Forge;
  activeTab: string;
  supported: boolean;
  isLoading: boolean;
  hasPipeline: boolean;
}

export function shouldShowBranchCiTab(input: BranchCiTabVisibilityInput): boolean {
  return (
    !input.hasPullRequest &&
    !(input.activeTab === "pr" && input.prLoading) &&
    input.forgeBranchPipelineEnabled &&
    (input.prForge === "gitlab" || input.activeTab === "ci") &&
    (input.hasPipeline || input.isLoading || (input.activeTab === "ci" && input.supported))
  );
}
