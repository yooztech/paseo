import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { UsePrPaneDataResult } from "@/git/pull-request-panel/use-data";
import { BranchCiPane, useBranchCiPipeline } from "@/git/branch-ci-panel";
// FORK(repository-graph): register the fork-only repository graph explorer.
import { RepositoryGraphPane } from "@/fork/repository-graph/pane";
import { GitLabIcon } from "@/components/icons/gitlab-icon";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import { useSessionStore } from "@/stores/session-store";
import type { Theme } from "@/styles/theme";
import {
  type ExplorerTabContributionId,
  explorerTabContributionQueryKinds,
  isExplorerTabContributionId,
} from "./explorer-tab-contribution-registry";

export {
  explorerTabContributionQueryKinds,
  isExplorerTabContributionId,
  type ExplorerTabContributionId,
};

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

function shouldShowBranchCiTab(input: {
  hasPullRequest: boolean;
  prLoading: boolean;
  forgeBranchPipelineEnabled: boolean;
  prForge: UsePrPaneDataResult["forge"];
  activeTab: ExplorerTabContributionInput["activeTab"];
  supported: boolean;
  isLoading: boolean;
  hasPipeline: boolean;
}): boolean {
  return (
    !input.hasPullRequest &&
    !(input.activeTab === "pr" && input.prLoading) &&
    input.forgeBranchPipelineEnabled &&
    (input.prForge === "gitlab" || input.activeTab === "ci") &&
    (input.hasPipeline || input.isLoading || (input.activeTab === "ci" && input.supported))
  );
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
  const branchCiEnabled =
    canQuery &&
    input.isOpen &&
    !input.hasPullRequest &&
    !input.prLoading &&
    forgeBranchPipelineEnabled &&
    input.prForge === "gitlab" &&
    Boolean(currentBranch);
  const branchCi = useBranchCiPipeline({
    serverId: input.serverId,
    cwd: input.workspaceRoot,
    branch: currentBranch,
    enabled: branchCiEnabled || (input.activeTab === "ci" && canQuery && input.isOpen),
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
