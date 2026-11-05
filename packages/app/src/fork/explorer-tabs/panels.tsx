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
import { RepositoryGraphPane } from "@/fork/repository-graph/pane";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel, type PanelDescriptor } from "@/panels/panel-registry";
import { useWorkspaceDirectory, useWorkspaceFields } from "@/stores/session-store-hooks";
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
