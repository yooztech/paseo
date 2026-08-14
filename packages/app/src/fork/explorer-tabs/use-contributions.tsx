import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { GitLabIcon } from "@/components/icons/gitlab-icon";
import { BranchCiPane } from "@/fork/branch-ci/pane";
import { useBranchCiPipeline } from "@/fork/branch-ci/use-data";
import { shouldShowBranchCiTab } from "@/fork/branch-ci/visibility";
import { RepositoryGraphPane } from "@/fork/repository-graph/pane";
import type { UsePrPaneDataResult } from "@/git/pull-request-panel/use-data";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import { useSessionStore } from "@/stores/session-store";
import type { Theme } from "@/styles/theme";
import type { ExplorerTabContributionId } from "./registry";

export interface ExplorerTabContribution {
  tab: ExplorerTabContributionId;
  rank: number;
  label: string;
  icon?: (input: { active: boolean; theme: Theme }) => ReactNode;
  content: ReactNode;
}

interface ExplorerTabContributionInput {
  serverId: string;
  workspaceId?: string | null;
  workspaceRoot: string;
  isGit: boolean;
  isOpen: boolean;
  activeTab: ExplorerTabContributionId | "changes" | "files" | "pr";
  hasPullRequest: boolean;
  prLoading: boolean;
  prForge: UsePrPaneDataResult["forge"];
}

export function useExplorerTabContributions(
  input: ExplorerTabContributionInput,
): readonly ExplorerTabContribution[] {
  const { t } = useTranslation();
  const forgeBranchPipelineEnabled = useSessionStore(
    (state) => state.sessions[input.serverId]?.serverInfo?.features?.forgeBranchPipeline === true,
  );
  const currentBranch = useWorkspaceFields(
    input.serverId,
    input.workspaceId ?? null,
    (workspace) => workspace.gitRuntime?.currentBranch ?? null,
  );
  const canQuery = input.isGit && Boolean(input.workspaceRoot);
  const branchCiDiscoveryEnabled =
    canQuery &&
    input.isOpen &&
    !input.hasPullRequest &&
    !input.prLoading &&
    forgeBranchPipelineEnabled &&
    input.prForge === "gitlab" &&
    Boolean(currentBranch);
  const persistedBranchCiEnabled =
    input.activeTab === "ci" && canQuery && input.isOpen && forgeBranchPipelineEnabled;
  const branchCi = useBranchCiPipeline({
    serverId: input.serverId,
    cwd: input.workspaceRoot,
    branch: currentBranch,
    enabled: branchCiDiscoveryEnabled || persistedBranchCiEnabled,
  });
  const showCiTab = shouldShowBranchCiTab({
    hasPullRequest: input.hasPullRequest,
    prLoading: input.prLoading,
    forgeBranchPipelineEnabled,
    prForge: input.prForge,
    activeTab: input.activeTab,
    supported: branchCi.supported,
    isLoading: branchCi.isLoading,
    hasPipeline: branchCi.pipeline !== null,
  });

  const contributions: ExplorerTabContribution[] = [];
  if (input.isGit) {
    contributions.push({
      tab: "repository_graph",
      rank: 1,
      label: t("workspace.tabs.explorer.repositoryGraph"),
      content: (
        <RepositoryGraphPane
          serverId={input.serverId}
          workspaceId={input.workspaceId}
          cwd={input.workspaceRoot}
          enabled={input.isOpen}
        />
      ),
    });
  }
  if (input.isGit && showCiTab) {
    contributions.push({
      tab: "ci",
      rank: 4,
      label: t("workspace.tabs.explorer.ci"),
      icon: ({ active, theme }) => (
        <GitLabIcon
          size={13}
          color={active ? theme.colors.foreground : theme.colors.foregroundMuted}
        />
      ),
      content: (
        <BranchCiPane
          serverId={input.serverId}
          cwd={input.workspaceRoot}
          pipeline={branchCi.pipeline}
          branch={branchCi.branch}
          isLoading={branchCi.isLoading}
          error={branchCi.error}
        />
      ),
    });
  }
  return contributions;
}
