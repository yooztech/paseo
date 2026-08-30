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
import type { PanelDescriptor, PanelRegistration } from "@/panels/panel-registry";
import { useWorkspaceDirectory, useWorkspaceFields } from "@/stores/session-store-hooks";
import { useSessionStore } from "@/stores/session-store";

const ThemedGitGraph = withUnistyles(GitGraph);

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
        <Text style={styles.mutedText}>{t("workspace.tabs.sidePanel.ciUpdateHost")}</Text>
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
  const label = t("workspace.tabs.sidePanel.repositoryGraph");
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
  const label = t("workspace.tabs.sidePanel.ci");
  return {
    label,
    subtitle: label,
    tooltip: label,
    titleState: "ready",
    icon: GitLabIcon,
    statusBucket: null,
  };
}

export const repositoryGraphPanelRegistration: PanelRegistration<"repository_graph"> = {
  kind: "repository_graph",
  component: RepositoryGraphPanel,
  useDescriptor: useRepositoryGraphDescriptor,
  resourceKey: () => "repository_graph",
};

export const branchCiPanelRegistration: PanelRegistration<"branch_ci"> = {
  kind: "branch_ci",
  component: BranchCiPanel,
  useDescriptor: useBranchCiDescriptor,
  resourceKey: () => "branch_ci",
};

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
