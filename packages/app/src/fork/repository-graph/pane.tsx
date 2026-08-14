import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, Text, View, type ListRenderItemInfo } from "react-native";
import {
  ChevronRight,
  Copy,
  File,
  GitBranch,
  Pencil,
  RotateCw,
  Tag,
  Trash2,
} from "lucide-react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type {
  RepositoryGraphCommit,
  RepositoryGraphCommitDetails,
} from "@getpaseo/protocol/messages";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useToast } from "@/contexts/toast-context";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { useSessionStore } from "@/stores/session-store";
import type { Theme } from "@/styles/theme";
import { formatTimeAgo } from "@/utils/time";
import { collectAllTabs, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { layoutRepositoryGraph, type RepositoryGraphRowLayout } from "./layout";
import { useRepositoryGraphCommitDetails } from "./use-commit-details";
import { useRepositoryGraphHistory } from "./use-history";
import { useRepositoryGraphRefMutation } from "./use-ref-mutation";
import { RefDeleteModal } from "./ref-delete-modal";

const ROW_HEIGHT = 52;
const LANE_WIDTH = 14;
const LANE_PADDING = 10;
const GRAPH_COLORS = [
  "#0085d9",
  "#d9008f",
  "#00a92d",
  "#d98500",
  "#a300d9",
  "#e02d2d",
  "#00a89d",
  "#d53bdd",
  "#72ad00",
  "#dc5b23",
  "#6f24d6",
  "#bd8f00",
];
const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedFile = withUnistyles(File);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const ThemedPencil = withUnistyles(Pencil);
const ThemedTrash = withUnistyles(Trash2);
const ThemedCopy = withUnistyles(Copy);
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const destructiveColorMapping = (theme: Theme) => ({ color: theme.colors.palette.red[500] });
const interactiveRowStyle = ({ pressed }: { pressed: boolean }) => [
  styles.row,
  pressed && styles.rowHovered,
];
const interactiveFileRowStyle = ({ pressed }: { pressed: boolean }) => [
  styles.fileRow,
  pressed && styles.fileRowHovered,
];

function getContrastingTextColor(backgroundColor: string): string {
  const red = Number.parseInt(backgroundColor.slice(1, 3), 16);
  const green = Number.parseInt(backgroundColor.slice(3, 5), 16);
  const blue = Number.parseInt(backgroundColor.slice(5, 7), 16);
  return red * 0.299 + green * 0.587 + blue * 0.114 > 150 ? "#111827" : "#ffffff";
}

function GraphCell({ row, laneCount }: { row: RepositoryGraphRowLayout; laneCount: number }) {
  const width = LANE_PADDING * 2 + laneCount * LANE_WIDTH;
  const x = (column: number) => LANE_PADDING + column * LANE_WIDTH + LANE_WIDTH / 2;
  return (
    <Svg width={width} height={ROW_HEIGHT} viewBox={`0 0 ${width} ${ROW_HEIGHT}`}>
      {row.edges.map((edge) => {
        const fromX = x(edge.from);
        const toX = x(edge.to);
        const startY = edge.startsAtCommit ? ROW_HEIGHT / 2 : 0;
        return (
          <Path
            key={`${edge.from}-${edge.to}-${edge.color}-${edge.startsAtCommit}`}
            d={`M ${fromX} ${startY} C ${fromX} ${(startY + ROW_HEIGHT) / 2}, ${toX} ${(startY + ROW_HEIGHT) / 2}, ${toX} ${ROW_HEIGHT}`}
            fill="none"
            stroke={GRAPH_COLORS[edge.color % GRAPH_COLORS.length]}
            strokeWidth={2}
          />
        );
      })}
      {!row.startsLane ? (
        <Path
          d={`M ${x(row.column)} 0 L ${x(row.column)} ${ROW_HEIGHT / 2}`}
          fill="none"
          stroke={GRAPH_COLORS[row.color % GRAPH_COLORS.length]}
          strokeWidth={2}
        />
      ) : null}
      <Circle
        cx={x(row.column)}
        cy={ROW_HEIGHT / 2}
        r={4}
        fill={GRAPH_COLORS[row.color % GRAPH_COLORS.length]}
      />
    </Svg>
  );
}

type GraphRef = RepositoryGraphCommit["refs"][number];

function RefBadge({
  refInfo,
  remote,
  color,
  actionsEnabled,
  onRename,
  onDelete,
  onCopy,
}: {
  refInfo: GraphRef;
  remote?: string;
  color: string;
  actionsEnabled: boolean;
  onRename: (refInfo: GraphRef) => void;
  onDelete: (refInfo: GraphRef) => void;
  onCopy: (refInfo: GraphRef) => void;
}) {
  const { t } = useTranslation();
  const RefIcon = refInfo.kind === "tag" ? Tag : GitBranch;
  const foregroundColor = getContrastingTextColor(color);
  const handleRename = useCallback(() => onRename(refInfo), [onRename, refInfo]);
  const handleDelete = useCallback(() => onDelete(refInfo), [onDelete, refInfo]);
  const handleCopy = useCallback(() => onCopy(refInfo), [onCopy, refInfo]);
  const renameLeading = useMemo(
    () => <ThemedPencil size={15} uniProps={foregroundMutedColorMapping} />,
    [],
  );
  const deleteLeading = useMemo(
    () => <ThemedTrash size={15} uniProps={destructiveColorMapping} />,
    [],
  );
  const copyLeading = useMemo(
    () => <ThemedCopy size={15} uniProps={foregroundMutedColorMapping} />,
    [],
  );
  const badge = (
    <View style={styles.refBadge}>
      <View style={[styles.localRef, { backgroundColor: color }]}>
        <RefIcon size={12} strokeWidth={2.5} color={foregroundColor} />
        <Text style={[styles.refText, { color: foregroundColor }]}>{refInfo.name}</Text>
      </View>
      {remote ? (
        <View style={styles.remoteRef}>
          <Text style={styles.remoteRefText}>{remote}</Text>
        </View>
      ) : null}
    </View>
  );
  const isTag = refInfo.kind === "tag";
  const isRemote = refInfo.kind === "remote";
  return (
    <ContextMenu>
      <ContextMenuTrigger testID={`repository-graph-ref-${refInfo.kind}-${refInfo.name}`}>
        {badge}
      </ContextMenuTrigger>
      <ContextMenuContent align="start" width={230} sheetTitle={refInfo.name}>
        {!isRemote && actionsEnabled ? (
          <ContextMenuItem leading={renameLeading} onSelect={handleRename}>
            {isTag
              ? t("workspace.repositoryGraph.actions.renameTag")
              : t("workspace.repositoryGraph.actions.renameBranch")}
          </ContextMenuItem>
        ) : null}
        {actionsEnabled ? (
          <ContextMenuItem
            leading={deleteLeading}
            destructive
            disabled={refInfo.current}
            onSelect={handleDelete}
          >
            {isTag
              ? t("workspace.repositoryGraph.actions.deleteTag")
              : t("workspace.repositoryGraph.actions.deleteBranch")}
          </ContextMenuItem>
        ) : null}
        {actionsEnabled ? <ContextMenuSeparator /> : null}
        <ContextMenuItem leading={copyLeading} onSelect={handleCopy}>
          {isTag
            ? t("workspace.repositoryGraph.actions.copyTagName")
            : t("workspace.repositoryGraph.actions.copyBranchName")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function RefBadges({
  refs,
  color,
  actionsEnabled,
  onRename,
  onDelete,
  onCopy,
}: {
  refs: GraphRef[];
  color: string;
  actionsEnabled: boolean;
  onRename: (refInfo: GraphRef) => void;
  onDelete: (refInfo: GraphRef) => void;
  onCopy: (refInfo: GraphRef) => void;
}) {
  const consumedRemotes = new Set<string>();
  const badges: Array<{ refInfo: GraphRef; remote?: string }> = refs.flatMap((refInfo) => {
    if (refInfo.kind === "remote" && consumedRemotes.has(refInfo.name)) {
      return [];
    }
    if (refInfo.kind !== "head") {
      return [{ refInfo }];
    }
    const remote = refs.find(
      (candidate) =>
        candidate.kind === "remote" &&
        (candidate.name === refInfo.upstream ||
          (!refInfo.upstream && candidate.name.split("/").slice(1).join("/") === refInfo.name)),
    );
    if (!remote) {
      return [{ refInfo }];
    }
    consumedRemotes.add(remote.name);
    return [{ refInfo, remote: remote.name.split("/")[0] }];
  });

  return badges.map(({ refInfo, remote }) => (
    <RefBadge
      key={`${refInfo.kind}:${refInfo.name}`}
      refInfo={refInfo}
      remote={remote}
      color={color}
      actionsEnabled={actionsEnabled}
      onRename={onRename}
      onDelete={onDelete}
      onCopy={onCopy}
    />
  ));
}

function CommitRow({
  row,
  laneCount,
  selected,
  onPress,
  actionsEnabled,
  onRenameRef,
  onDeleteRef,
  onCopyRef,
}: {
  row: RepositoryGraphRowLayout;
  laneCount: number;
  selected: boolean;
  onPress: () => void;
  actionsEnabled: boolean;
  onRenameRef: (refInfo: GraphRef) => void;
  onDeleteRef: (refInfo: GraphRef) => void;
  onCopyRef: (refInfo: GraphRef) => void;
}) {
  return (
    <View style={selected && styles.rowSelected}>
      <Pressable
        style={interactiveRowStyle}
        testID={`repository-graph-commit-${row.commit.shortSha}`}
        onPress={onPress}
      >
        <GraphCell row={row} laneCount={laneCount} />
        <View style={styles.commitBody}>
          <View style={styles.subjectLine}>
            <RefBadges
              refs={row.commit.refs}
              color={GRAPH_COLORS[row.color % GRAPH_COLORS.length] ?? GRAPH_COLORS[0]}
              actionsEnabled={actionsEnabled}
              onRename={onRenameRef}
              onDelete={onDeleteRef}
              onCopy={onCopyRef}
            />
            <Text style={styles.subject} numberOfLines={1}>
              {row.commit.subject}
            </Text>
          </View>
          <View style={styles.metaLine}>
            <Text style={styles.author} numberOfLines={1}>
              {row.commit.authorName}
            </Text>
            <Text style={styles.date}>{formatTimeAgo(new Date(row.commit.authorDate))}</Text>
            <Text style={styles.sha}>{row.commit.shortSha}</Text>
          </View>
        </View>
      </Pressable>
    </View>
  );
}

function ChangedFileRow({
  file,
  onOpenFile,
}: {
  file: RepositoryGraphCommitDetails["files"][number];
  onOpenFile: (path: string) => void;
}) {
  const handlePress = useCallback(() => onOpenFile(file.path), [file.path, onOpenFile]);
  return (
    <Pressable
      style={interactiveFileRowStyle}
      testID={`repository-graph-file-${file.path}`}
      onPress={handlePress}
    >
      <ThemedFile size={13} uniProps={foregroundMutedColorMapping} />
      <Text style={styles.filePath} numberOfLines={1}>
        {file.path}
      </Text>
      <Text style={styles.additions}>+{file.additions}</Text>
      <Text style={styles.deletions}>-{file.deletions}</Text>
      <Text style={styles.fileStatus}>{file.status?.charAt(0).toUpperCase() ?? "M"}</Text>
      <ThemedChevronRight size={13} uniProps={foregroundMutedColorMapping} />
    </Pressable>
  );
}

function DetailField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <View style={styles.detailField}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, mono && styles.detailMono]} selectable numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function CommitDetails({
  serverId,
  cwd,
  sha,
  onOpenFile,
}: {
  serverId: string;
  cwd: string;
  sha: string;
  onOpenFile: (path: string) => void;
}) {
  const { t } = useTranslation();
  const query = useRepositoryGraphCommitDetails({ serverId, cwd, sha, enabled: true });

  if (!query.supported) {
    return (
      <View style={styles.details}>
        <State message={t("workspace.repositoryGraph.detailsUpdateHost")} />
      </View>
    );
  }
  if (query.isLoading && !query.data) {
    return (
      <View style={styles.details}>
        <State message={t("workspace.repositoryGraph.detailsLoading")} loading />
      </View>
    );
  }
  if (query.error || !query.data) {
    return (
      <View style={styles.details}>
        <State message={t("workspace.repositoryGraph.detailsLoadError")} />
      </View>
    );
  }

  const details = query.data;
  const formatDate = (value: string) => new Date(value).toLocaleString();
  return (
    <View style={styles.details} testID={`repository-graph-details-${details.sha.slice(0, 7)}`}>
      <View style={styles.detailColumns}>
        <ScrollView style={styles.summaryPane} contentContainerStyle={styles.summaryContent}>
          <DetailField label={t("workspace.repositoryGraph.commit")} value={details.sha} mono />
          <DetailField
            label={t("workspace.repositoryGraph.parents")}
            value={details.parents.join(", ") || t("workspace.repositoryGraph.none")}
            mono
          />
          <DetailField
            label={t("workspace.repositoryGraph.author")}
            value={`${details.authorName}${details.authorEmail ? ` <${details.authorEmail}>` : ""}`}
          />
          <DetailField
            label={t("workspace.repositoryGraph.authorDate")}
            value={formatDate(details.authorDate)}
          />
          <DetailField
            label={t("workspace.repositoryGraph.committer")}
            value={`${details.committerName}${details.committerEmail ? ` <${details.committerEmail}>` : ""}`}
          />
          <DetailField
            label={t("workspace.repositoryGraph.committerDate")}
            value={formatDate(details.committerDate)}
          />
          <Text style={styles.detailSubject} selectable>
            {details.subject}
          </Text>
          {details.body ? (
            <Text style={styles.detailBody} selectable>
              {details.body}
            </Text>
          ) : null}
        </ScrollView>
        <ScrollView style={styles.filesPane} contentContainerStyle={styles.filesContent}>
          {details.files.map((file) => (
            <ChangedFileRow key={file.path} file={file} onOpenFile={onOpenFile} />
          ))}
          {details.files.length === 0 ? (
            <Text style={styles.emptyFiles}>{t("workspace.repositoryGraph.noChangedFiles")}</Text>
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}

function CommitGraphItem({
  item,
  laneCount,
  selectedSha,
  setSelectedSha,
  serverId,
  cwd,
  persistenceKey,
  openWorkspaceTabFocused,
  retargetWorkspaceTab,
  actionsEnabled,
  onRenameRef,
  onDeleteRef,
  onCopyRef,
}: {
  item: RepositoryGraphRowLayout;
  laneCount: number;
  selectedSha: string | null;
  setSelectedSha: (sha: string | null) => void;
  serverId: string;
  cwd: string;
  persistenceKey: string | null;
  openWorkspaceTabFocused: ReturnType<typeof useWorkspaceLayoutStore.getState>["openTabFocused"];
  retargetWorkspaceTab: ReturnType<typeof useWorkspaceLayoutStore.getState>["retargetTab"];
  actionsEnabled: boolean;
  onRenameRef: (refInfo: GraphRef) => void;
  onDeleteRef: (refInfo: GraphRef) => void;
  onCopyRef: (refInfo: GraphRef) => void;
}) {
  const selected = item.commit.sha === selectedSha;
  const handlePress = useCallback(
    () => setSelectedSha(selected ? null : item.commit.sha),
    [item.commit.sha, selected, setSelectedSha],
  );
  const handleOpenFile = useCallback(
    (path: string) => {
      if (!persistenceKey) {
        return;
      }
      const target = {
        kind: "repository_graph_file_diff" as const,
        sha: item.commit.sha,
        path,
        requestId: Date.now(),
      };
      const layout = useWorkspaceLayoutStore.getState().layoutByWorkspace[persistenceKey];
      const existingTab = layout
        ? collectAllTabs(layout.root).find(
            (tab) =>
              tab.target.kind === "repository_graph_file_diff" &&
              tab.target.sha === item.commit.sha,
          )
        : undefined;
      if (existingTab) {
        retargetWorkspaceTab(persistenceKey, existingTab.tabId, target);
        return;
      }
      openWorkspaceTabFocused(persistenceKey, target);
    },
    [item.commit.sha, openWorkspaceTabFocused, persistenceKey, retargetWorkspaceTab],
  );
  return (
    <View>
      <CommitRow
        row={item}
        laneCount={laneCount}
        selected={selected}
        onPress={handlePress}
        actionsEnabled={actionsEnabled}
        onRenameRef={onRenameRef}
        onDeleteRef={onDeleteRef}
        onCopyRef={onCopyRef}
      />
      {selected ? (
        <CommitDetails
          serverId={serverId}
          cwd={cwd}
          sha={item.commit.sha}
          onOpenFile={handleOpenFile}
        />
      ) : null}
    </View>
  );
}

function State({ message, loading = false }: { message: string; loading?: boolean }) {
  return (
    <View style={styles.state}>
      {loading ? <ThemedLoadingSpinner size="small" uniProps={foregroundColorMapping} /> : null}
      <Text style={styles.stateText}>{message}</Text>
    </View>
  );
}

export function RepositoryGraphPane({
  serverId,
  workspaceId,
  cwd,
  enabled,
}: {
  serverId: string;
  workspaceId?: string | null;
  cwd: string;
  enabled: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [selectedSha, setSelectedSha] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<GraphRef | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GraphRef | null>(null);
  const refActionsSupported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.repositoryGraphRefActions === true,
  );
  const refMutation = useRepositoryGraphRefMutation(serverId, cwd);
  const openWorkspaceTabFocused = useWorkspaceLayoutStore((state) => state.openTabFocused);
  const retargetWorkspaceTab = useWorkspaceLayoutStore((state) => state.retargetTab);
  const persistenceKey = useMemo(
    () => buildWorkspaceTabPersistenceKey({ serverId, workspaceId: workspaceId ?? cwd }),
    [cwd, serverId, workspaceId],
  );
  const query = useRepositoryGraphHistory({ serverId, cwd, enabled });
  const rows = useMemo(
    () => layoutRepositoryGraph(query.data?.commits ?? []),
    [query.data?.commits],
  );
  const laneCount = useMemo(
    () => rows.reduce((maximum, row) => Math.max(maximum, row.laneCount), 1),
    [rows],
  );
  const handleOpenRename = useCallback((refInfo: GraphRef) => setRenameTarget(refInfo), []);
  const handleOpenDelete = useCallback((refInfo: GraphRef) => setDeleteTarget(refInfo), []);
  const handleCopyRef = useCallback(
    (refInfo: GraphRef) => {
      void copyToClipboard(refInfo.name)
        .then(() =>
          toast.show(
            refInfo.kind === "tag"
              ? t("workspace.repositoryGraph.actions.tagNameCopied")
              : t("workspace.repositoryGraph.actions.branchNameCopied"),
            { variant: "success" },
          ),
        )
        .catch(() => toast.error(t("workspace.tabs.toasts.copyFailed")));
    },
    [t, toast],
  );
  const closeRename = useCallback(() => setRenameTarget(null), []);
  const closeDelete = useCallback(() => setDeleteTarget(null), []);
  const submitRename = useCallback(
    async (newName: string) => {
      if (!renameTarget) return;
      await refMutation.mutateAsync({
        action: "rename",
        refKind: renameTarget.kind,
        name: renameTarget.name,
        newName,
      });
      toast.show(t("workspace.repositoryGraph.actions.renamed"), { variant: "success" });
    },
    [refMutation, renameTarget, t, toast],
  );
  const submitDelete = useCallback(
    async (options: { force: boolean; deleteOnRemote: boolean }) => {
      if (!deleteTarget) return;
      await refMutation.mutateAsync({
        action: "delete",
        refKind: deleteTarget.kind,
        name: deleteTarget.name,
        ...options,
      });
      toast.show(t("workspace.repositoryGraph.actions.deleted"), { variant: "success" });
    },
    [deleteTarget, refMutation, t, toast],
  );
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<RepositoryGraphRowLayout>) => (
      <CommitGraphItem
        item={item}
        laneCount={laneCount}
        selectedSha={selectedSha}
        setSelectedSha={setSelectedSha}
        serverId={serverId}
        cwd={cwd}
        persistenceKey={persistenceKey}
        openWorkspaceTabFocused={openWorkspaceTabFocused}
        retargetWorkspaceTab={retargetWorkspaceTab}
        actionsEnabled={refActionsSupported}
        onRenameRef={handleOpenRename}
        onDeleteRef={handleOpenDelete}
        onCopyRef={handleCopyRef}
      />
    ),
    [
      cwd,
      laneCount,
      openWorkspaceTabFocused,
      persistenceKey,
      retargetWorkspaceTab,
      refActionsSupported,
      handleOpenRename,
      handleOpenDelete,
      handleCopyRef,
      selectedSha,
      serverId,
    ],
  );
  const keyExtractor = useCallback((row: RepositoryGraphRowLayout) => row.commit.sha, []);
  const refetch = query.refetch;
  const handleRetry = useCallback(() => {
    void refetch();
  }, [refetch]);

  if (!query.supported) {
    return <State message={t("workspace.repositoryGraph.updateHost")} />;
  }
  if (!query.isConnected) {
    return <State message={t("workspace.terminal.hostDisconnected")} />;
  }
  if (query.isLoading && rows.length === 0) {
    return <State message={t("workspace.repositoryGraph.loading")} loading />;
  }
  if (query.error) {
    return (
      <View style={styles.state}>
        <Text style={styles.errorText}>{t("workspace.repositoryGraph.loadError")}</Text>
        <Pressable style={styles.retryButton} onPress={handleRetry}>
          <ThemedRotateCw size={14} uniProps={foregroundColorMapping} />
          <Text style={styles.retryText}>{t("workspace.repositoryGraph.retry")}</Text>
        </Pressable>
      </View>
    );
  }
  if (rows.length === 0) {
    return <State message={t("workspace.repositoryGraph.empty")} />;
  }
  return (
    <View style={styles.list}>
      <FlatList
        data={rows}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.listContent}
        testID="repository-graph-list"
      />
      {query.data?.hasMore ? (
        <View>
          <Text style={styles.limitText}>
            {t("workspace.repositoryGraph.limit", { count: rows.length })}
          </Text>
        </View>
      ) : null}
      <AdaptiveRenameModal
        visible={renameTarget !== null}
        title={
          renameTarget?.kind === "tag"
            ? t("workspace.repositoryGraph.actions.renameTag")
            : t("workspace.repositoryGraph.actions.renameBranch")
        }
        initialValue={renameTarget?.name ?? ""}
        onClose={closeRename}
        onSubmit={submitRename}
        testID="repository-graph-ref-rename"
      />
      <RefDeleteModal
        visible={deleteTarget !== null}
        name={deleteTarget?.name ?? ""}
        kind={deleteTarget?.kind ?? "head"}
        hasUpstream={Boolean(deleteTarget?.upstream)}
        onClose={closeDelete}
        onSubmit={submitDelete}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: { flex: 1 },
  listContent: { paddingVertical: theme.spacing[2] },
  row: {
    height: ROW_HEIGHT,
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderAccent,
  },
  rowHovered: { backgroundColor: theme.colors.surface1 },
  rowSelected: { backgroundColor: theme.colors.surface2 },
  commitBody: { flex: 1, minWidth: 0, justifyContent: "center", paddingRight: theme.spacing[3] },
  subjectLine: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1] },
  subject: { flex: 1, color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  metaLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginTop: theme.spacing[1],
  },
  author: { maxWidth: 110, color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
  date: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
  sha: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.xs,
  },
  refBadge: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: theme.borderRadius.base,
    overflow: "hidden",
  },
  localRef: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingLeft: theme.spacing[1],
  },
  refText: {
    fontSize: theme.fontSize.xs,
    paddingRight: theme.spacing[1],
    paddingVertical: 1,
  },
  remoteRef: {
    alignSelf: "stretch",
    justifyContent: "center",
    backgroundColor: theme.colors.surface3,
    paddingHorizontal: theme.spacing[1],
  },
  remoteRefText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontStyle: "italic",
  },
  state: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[4],
  },
  stateText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  errorText: { color: theme.colors.destructive, fontSize: theme.fontSize.sm, textAlign: "center" },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[2],
  },
  retryText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  limitText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    textAlign: "center",
    padding: theme.spacing[3],
  },
  details: {
    height: 280,
    position: "relative",
    backgroundColor: theme.colors.surface1,
    borderBottomWidth: 2,
    borderBottomColor: theme.colors.borderAccent,
  },
  detailColumns: { flex: 1, flexDirection: { xs: "column", md: "row" } },
  summaryPane: {
    flex: 1,
    borderRightWidth: { xs: 0, md: 1 },
    borderBottomWidth: { xs: 1, md: 0 },
    borderColor: theme.colors.borderAccent,
  },
  summaryContent: { padding: theme.spacing[3] },
  detailField: { flexDirection: "row", gap: theme.spacing[2], marginBottom: 2 },
  detailLabel: { color: theme.colors.foreground, fontSize: theme.fontSize.xs, fontWeight: "600" },
  detailValue: { flex: 1, color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
  detailMono: { fontFamily: theme.fontFamily.mono },
  detailSubject: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    marginTop: theme.spacing[3],
  },
  detailBody: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[2],
  },
  filesPane: { flex: 1 },
  filesContent: { paddingVertical: theme.spacing[1] },
  fileRow: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
  },
  fileRowHovered: { backgroundColor: theme.colors.surface2 },
  filePath: { flex: 1, color: theme.colors.foreground, fontSize: theme.fontSize.xs },
  additions: {
    color: theme.colors.success,
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fontFamily.mono,
  },
  deletions: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fontFamily.mono,
  },
  fileStatus: {
    width: 14,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fontFamily.mono,
    textAlign: "center",
  },
  emptyFiles: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    padding: theme.spacing[3],
  },
}));
