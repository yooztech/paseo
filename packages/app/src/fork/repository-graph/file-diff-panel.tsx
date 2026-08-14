import { useCallback, useMemo, type ReactNode } from "react";
import { Text, View } from "react-native";
import { GitCommitHorizontal } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import invariant from "tiny-invariant";
import { useIsCompactFormFactor, WORKSPACE_SECONDARY_HEADER_HEIGHT } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { DiffLayoutToggle, resolveDiffLayout, SharedDiffView } from "@/git/diff-pane";
import { useChangesPreferences } from "@/hooks/use-changes-preferences";
import { useAppSettings } from "@/hooks/use-settings";
import { usePaneContext } from "@/panels/pane-context";
import type { PanelDescriptor, PanelRegistration } from "@/panels/panel-registry";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import { useRepositoryGraphFileDiff } from "./use-file-diff";

const ThemedGitCommitHorizontal = withUnistyles(GitCommitHorizontal);

function RepositoryGraphFileDiffPanel() {
  const { serverId, workspaceId, target } = usePaneContext();
  invariant(
    target.kind === "repository_graph_file_diff",
    "RepositoryGraphFileDiffPanel requires repository_graph_file_diff target",
  );
  const cwd = useWorkspaceDirectory(serverId, workspaceId);
  const { settings } = useAppSettings();
  const { preferences, updatePreferences } = useChangesPreferences();
  const isCompact = useIsCompactFormFactor();
  const canUseSplitLayout = isWeb && !isCompact;
  const displayPreferences = useMemo(
    () => ({
      layout: resolveDiffLayout(preferences.layout, canUseSplitLayout),
      wrapLines: preferences.wrapLines,
      codeFontSize: settings.codeFontSize,
      monoFontFamily: settings.monoFontFamily,
    }),
    [canUseSplitLayout, preferences.layout, preferences.wrapLines, settings],
  );
  const diff = useRepositoryGraphFileDiff({
    serverId,
    cwd: cwd ?? "",
    sha: target.sha,
    path: target.path,
  });
  const toggleLayout = useCallback(() => {
    void updatePreferences({ layout: preferences.layout === "unified" ? "split" : "unified" });
  }, [preferences.layout, updatePreferences]);
  const mode = useMemo(() => ({ kind: "commit" as const }), []);
  let body: ReactNode;
  if (!cwd) {
    body = <PanelState message="Workspace directory is unavailable." />;
  } else if (diff.error) {
    body = <PanelState message="Unable to load file diff." error />;
  } else if (diff.isLoading && diff.files.length === 0) {
    body = <PanelState message="Loading diff..." />;
  } else if (diff.files.length === 0) {
    body = <PanelState message="No textual changes." />;
  } else {
    body = (
      <SharedDiffView files={diff.files} displayPreferences={displayPreferences} mode={mode} />
    );
  }

  return (
    <View style={styles.container} testID="repository-graph-file-diff-panel">
      {canUseSplitLayout ? (
        <View style={styles.toolbar}>
          <DiffLayoutToggle
            layout={preferences.layout}
            isMobile={isCompact}
            testID="repository-graph-file-diff-toggle-layout"
            onToggle={toggleLayout}
          />
        </View>
      ) : null}
      <View style={styles.body}>{body}</View>
    </View>
  );
}

function PanelState({ message, error = false }: { message: string; error?: boolean }) {
  return (
    <View style={styles.state}>
      <Text style={error ? styles.errorText : styles.mutedText}>{message}</Text>
    </View>
  );
}

function useDescriptor(
  target: Extract<WorkspaceTabTarget, { kind: "repository_graph_file_diff" }>,
): PanelDescriptor {
  return {
    label: target.path.split("/").findLast(Boolean) ?? target.path,
    subtitle: target.path,
    tooltip: `${target.path} (${target.sha.slice(0, 7)})`,
    titleState: "ready",
    icon: ThemedGitCommitHorizontal,
    statusBucket: null,
  };
}

export const repositoryGraphFileDiffPanelRegistration: PanelRegistration<"repository_graph_file_diff"> =
  {
    kind: "repository_graph_file_diff",
    component: RepositoryGraphFileDiffPanel,
    useDescriptor,
  };

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, minHeight: 0 },
  toolbar: {
    height: WORKSPACE_SECONDARY_HEADER_HEIGHT,
    alignItems: "flex-end",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderAccent,
  },
  body: { flex: 1, minHeight: 0 },
  state: { flex: 1, alignItems: "center", justifyContent: "center", padding: theme.spacing[4] },
  mutedText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  errorText: { color: theme.colors.statusDanger, fontSize: theme.fontSize.sm },
}));
