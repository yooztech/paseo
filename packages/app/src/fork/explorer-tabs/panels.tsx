import type { ReactNode } from "react";
import type { TFunction } from "i18next";
import { Text, View } from "react-native";
import { GitGraph } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import invariant from "tiny-invariant";
import { GitLabIcon } from "@/components/icons/gitlab-icon";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { BranchCiPane } from "@/fork/branch-ci/pane";
import { useBranchCiPipeline } from "@/fork/branch-ci/use-data";
import { shouldShowBranchCiTab } from "@/fork/branch-ci/visibility";
import { RepositoryGraphPane } from "@/fork/repository-graph/pane";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel, type PanelDescriptor } from "@/panels/panel-registry";
import type { UsePrPaneDataResult } from "@/git/pull-request-panel/use-data";
import { useWorkspaceDirectory, useWorkspaceFields } from "@/stores/session-store-hooks";
import type { ExplorerTab } from "@/stores/panel-store";
import type { Theme } from "@/styles/theme";
import { useSessionStore } from "@/stores/session-store";

const ThemedGitGraph = withUnistyles(GitGraph);
const repositoryGraphPresentation = {
  label: (t: TFunction) => t("workspace.tabs.explorerSidebar.repositoryGraph"),
  subtitle: (t: TFunction) => t("workspace.tabs.explorerSidebar.repositoryGraph"),
  tooltip: (t: TFunction) => t("workspace.tabs.explorerSidebar.repositoryGraph"),
  icon: ThemedGitGraph,
};

const branchCiPresentation = {
  label: (t: TFunction) => t("workspace.tabs.explorerSidebar.ci"),
  subtitle: (t: TFunction) => t("workspace.tabs.explorerSidebar.ci"),
  tooltip: (t: TFunction) => t("workspace.tabs.explorerSidebar.ci"),
  icon: GitLabIcon,
};

export interface CompactExplorerForkTab {
  tab: Extract<ExplorerTab, "repository_graph" | "branch_ci">;
  rank: number;
  label: string;
  icon?: (input: { active: boolean; theme: Theme }) => ReactNode;
  content: ReactNode;
}

interface CompactExplorerForkTabsInput {
  serverId: string;
  workspaceId?: string | null;
  workspaceRoot: string;
  isGit: boolean;
  isOpen: boolean;
  activeTab: ExplorerTab;
  hasPullRequest: boolean;
  prLoading: boolean;
  prForge: UsePrPaneDataResult["forge"];
}

export function useCompactExplorerForkTabs(
  input: CompactExplorerForkTabsInput,
): readonly CompactExplorerForkTab[] {
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
    input.activeTab === "branch_ci" && canQuery && input.isOpen && forgeBranchPipelineEnabled;
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

  const tabs: CompactExplorerForkTab[] = [];
  if (input.isGit) {
    tabs.push({
      tab: "repository_graph",
      rank: 1,
      label: t("workspace.tabs.explorerSidebar.repositoryGraph"),
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
    tabs.push({
      tab: "branch_ci",
      rank: 4,
      icon: ({ active, theme }) => (
        <GitLabIcon
          size={13}
          color={active ? theme.colors.foreground : theme.colors.foregroundMuted}
        />
      ),
      label: t("workspace.tabs.explorerSidebar.ci"),
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
  return tabs;
}

function RepositoryGraphPanel() {
  const { serverId, workspaceId, target } = usePaneContext();
  const cwd = useWorkspaceDirectory(serverId, workspaceId);
  const enabled = useRetainedPanelActive();
  invariant(target.kind === "repository_graph", "RepositoryGraphPanel requires repository_graph");
  if (!cwd) {
    return <MissingDirectory />;
  }
  return (
    <RepositoryGraphPane
      serverId={serverId}
      workspaceId={workspaceId}
      cwd={cwd}
      enabled={enabled}
    />
  );
}

function BranchCiPanel() {
  const { serverId, workspaceId, target } = usePaneContext();
  const { t } = useTranslation();
  const cwd = useWorkspaceDirectory(serverId, workspaceId);
  const branch = useWorkspaceFields(
    serverId,
    workspaceId,
    (workspace) => workspace.gitRuntime?.currentBranch ?? null,
  );
  const enabled = useRetainedPanelActive();
  const featureEnabled = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.forgeBranchPipeline === true,
  );
  invariant(target.kind === "branch_ci", "BranchCiPanel requires branch_ci");
  const branchCi = useBranchCiPipeline({
    serverId,
    cwd: cwd ?? "",
    branch,
    enabled: enabled && Boolean(cwd) && featureEnabled,
  });
  if (!cwd) {
    return <MissingDirectory />;
  }
  if (!featureEnabled) {
    return (
      <View style={styles.centerState}>
        <Text style={styles.mutedText}>{t("workspace.tabs.explorerSidebar.ciUpdateHost")}</Text>
      </View>
    );
  }
  return (
    <BranchCiPane
      serverId={serverId}
      cwd={cwd}
      pipeline={branchCi.pipeline}
      branch={branchCi.branch}
      isLoading={branchCi.isLoading}
      error={branchCi.error}
    />
  );
}

function MissingDirectory() {
  const { t } = useTranslation();
  return (
    <View style={styles.centerState}>
      <Text style={styles.mutedText}>{t("panels.file.directoryMissing")}</Text>
    </View>
  );
}

function useRepositoryGraphDescriptor(): PanelDescriptor {
  const { t } = useTranslation();
  const label = repositoryGraphPresentation.label(t);
  return {
    label,
    subtitle: label,
    tooltip: label,
    titleState: "ready",
    icon: ThemedGitGraph,
    statusBucket: null,
  };
}

function useBranchCiDescriptor(): PanelDescriptor {
  const { t } = useTranslation();
  const label = branchCiPresentation.label(t);
  return {
    label,
    subtitle: label,
    tooltip: label,
    titleState: "ready",
    icon: GitLabIcon,
    statusBucket: null,
  };
}

export const repositoryGraphPanelRegistration = definePanel("repository_graph", {
  component: RepositoryGraphPanel,
  useDescriptor: useRepositoryGraphDescriptor,
  presentation: repositoryGraphPresentation,
});

export const branchCiPanelRegistration = definePanel("branch_ci", {
  component: BranchCiPanel,
  useDescriptor: useBranchCiDescriptor,
  presentation: branchCiPresentation,
});

const styles = StyleSheet.create((theme) => ({
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
  },
  mutedText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
