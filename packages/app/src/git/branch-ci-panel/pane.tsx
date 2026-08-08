import React, { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ExternalLink, RotateCw } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import type {
  CheckoutPipeline,
  CheckoutPipelineJob,
  CheckoutPipelineStage,
} from "@getpaseo/protocol/messages";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useToast } from "@/contexts/toast-context";
import { useCheckoutGitActionsStore } from "@/git/actions-store";
import { getForgePresentation } from "@/git/forge";
import { mapPipelineStatus } from "@/git/forges/gitlab";
import {
  CheckStatusIcon,
  Section,
  SUMMARY_DANGER_ICON,
  SUMMARY_SUCCESS_ICON,
  SUMMARY_WARNING_ICON,
  SummaryPill,
  foregroundMutedColorMapping,
  sectionKitStyles,
} from "@/git/pull-request-panel/section-kit";
import { useSessionStore } from "@/stores/session-store";
import { ICON_SIZE } from "@/styles/theme";
import { openExternalUrl } from "@/utils/open-external-url";
import { formatDuration } from "@/utils/time";

const ThemedExternalLink = withUnistyles(ExternalLink);
const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

export function BranchCiPane({
  serverId,
  cwd,
  pipeline,
  branch,
  isLoading,
  error,
}: {
  serverId: string;
  cwd: string;
  pipeline: CheckoutPipeline | null;
  branch: string | null;
  isLoading: boolean;
  error: Error | null;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [open, setOpen] = useState(true);
  const handleToggle = useCallback(() => {
    setOpen((value) => !value);
  }, []);
  const jobs = useMemo(() => (pipeline?.stages ?? []).flatMap((stage) => stage.jobs), [pipeline]);
  const counts = useMemo(() => countPipelineJobs(jobs), [jobs]);

  const refreshSupported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.checkoutRefresh === true,
  );
  const runRefresh = useCheckoutGitActionsStore((state) => state.refresh);
  const isRefreshing =
    useCheckoutGitActionsStore((state) =>
      state.getStatus({ serverId, cwd, actionId: "refresh" }),
    ) === "pending";
  const forgePresentation = getForgePresentation("gitlab");

  const handleRefresh = useCallback(() => {
    if (isRefreshing) {
      return;
    }
    void runRefresh({ serverId, cwd }).catch((refreshError) => {
      toast.error(
        refreshError instanceof Error
          ? refreshError.message
          : t("workspace.git.diff.failedRefresh"),
      );
    });
  }, [cwd, isRefreshing, runRefresh, serverId, t, toast]);

  const handleOpenPipeline = useCallback(() => {
    if (pipeline?.url) {
      void openExternalUrl(pipeline.url);
    }
  }, [pipeline?.url]);

  return (
    <View style={styles.root} testID="branch-ci-pane">
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.toolbar} testID="branch-ci-toolbar">
          {branch ? (
            <Text style={styles.branchLabel} testID="branch-ci-branch">
              {branch}
            </Text>
          ) : (
            <View />
          )}
          {refreshSupported ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                isRefreshing
                  ? t("workspace.git.diff.refreshing")
                  : t("workspace.git.diff.refreshState", { brand: forgePresentation.brandLabel })
              }
              testID="branch-ci-refresh"
              style={refreshButtonStyle}
              hitSlop={8}
              onPress={handleRefresh}
              disabled={isRefreshing}
            >
              <View style={styles.refreshIcon}>
                {isRefreshing ? (
                  <ThemedLoadingSpinner
                    size={ICON_SIZE.sm}
                    uniProps={foregroundMutedColorMapping}
                  />
                ) : (
                  <ThemedRotateCw size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
                )}
              </View>
            </Pressable>
          ) : null}
        </View>
        <Section
          title={t("workspace.git.pr.sections.pipeline")}
          open={open}
          onToggle={handleToggle}
          summary={
            <>
              <SummaryPill
                count={counts.passed}
                icon={SUMMARY_SUCCESS_ICON}
                variant="success"
                testID="branch-ci-passed"
              />
              <SummaryPill
                count={counts.failed}
                icon={SUMMARY_DANGER_ICON}
                variant="danger"
                testID="branch-ci-failed"
              />
              <SummaryPill
                count={counts.pending}
                icon={SUMMARY_WARNING_ICON}
                variant="warning"
                testID="branch-ci-pending"
              />
              {pipeline ? <CheckStatusIcon status={mapPipelineStatus(pipeline.status)} /> : null}
            </>
          }
        >
          {isLoading ? (
            <Text style={sectionKitStyles.emptyText}>
              {t("workspace.git.pr.empty.loadingPipeline")}
            </Text>
          ) : null}
          {!isLoading && error ? (
            <Text style={sectionKitStyles.emptyText}>
              {error.message || t("workspace.git.pr.empty.pipelineJobsLoadFailed")}
            </Text>
          ) : null}
          {!isLoading && !error && !pipeline ? (
            <Text style={sectionKitStyles.emptyText} testID="branch-ci-empty">
              {t("workspace.git.pr.empty.noChecks")}
            </Text>
          ) : null}
          {!isLoading && pipeline ? (
            <>
              <Pressable
                onPress={handleOpenPipeline}
                style={rowPressableStyle}
                disabled={!pipeline.url}
                testID="branch-ci-pipeline-link"
              >
                <CheckStatusIcon status={mapPipelineStatus(pipeline.status)} />
                <Text style={sectionKitStyles.checkName} numberOfLines={1}>
                  {`Pipeline #${pipeline.id}`}
                </Text>
                {pipeline.rawStatus ? (
                  <Text style={sectionKitStyles.checkWorkflow} numberOfLines={1}>
                    {pipeline.rawStatus}
                  </Text>
                ) : null}
                {pipeline.url ? (
                  <View style={sectionKitStyles.checkTrailing}>
                    <ThemedExternalLink size={12} uniProps={foregroundMutedColorMapping} />
                  </View>
                ) : null}
              </Pressable>
              {pipeline.stages.length === 0 ? (
                <Text style={sectionKitStyles.emptyText}>{t("workspace.git.pr.empty.noJobs")}</Text>
              ) : (
                pipeline.stages.map((stage) => (
                  <PipelineStageGroup key={stage.name} stage={stage} />
                ))
              )}
            </>
          ) : null}
        </Section>
      </ScrollView>
    </View>
  );
}

function PipelineStageGroup({ stage }: { stage: CheckoutPipelineStage }) {
  return (
    <View>
      <View style={styles.pipelineStageHeader}>
        <CheckStatusIcon status={mapPipelineStatus(stage.status)} />
        <Text style={styles.pipelineStageName} numberOfLines={1}>
          {stage.name}
        </Text>
      </View>
      {stage.jobs.map((job) => (
        <PipelineJobRow key={job.id} job={job} />
      ))}
    </View>
  );
}

function PipelineJobRow({ job }: { job: CheckoutPipelineJob }) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => {
    if (job.url) {
      void openExternalUrl(job.url);
    }
  }, [job.url]);
  const duration =
    job.durationSeconds && job.durationSeconds > 0
      ? formatDuration(job.durationSeconds * 1000)
      : "";
  return (
    <Pressable onPress={handlePress} style={jobRowPressableStyle} disabled={!job.url}>
      <CheckStatusIcon status={mapPipelineStatus(job.status)} />
      <Text style={sectionKitStyles.checkName} numberOfLines={1}>
        {job.name}
      </Text>
      {job.allowFailure ? (
        <Text style={sectionKitStyles.checkWorkflow} numberOfLines={1}>
          {t("workspace.git.pr.empty.allowedToFail")}
        </Text>
      ) : null}
      <View style={sectionKitStyles.checkTrailing}>
        {duration ? <Text style={sectionKitStyles.checkDuration}>{duration}</Text> : null}
      </View>
    </Pressable>
  );
}

function countPipelineJobs(jobs: CheckoutPipelineJob[]) {
  const counts = { passed: 0, failed: 0, pending: 0 };
  for (const job of jobs) {
    const status = mapPipelineStatus(job.status);
    if (status === "success") counts.passed += 1;
    else if (status === "failure") counts.failed += 1;
    else if (status === "pending") counts.pending += 1;
  }
  return counts;
}

function rowPressableStyle({ hovered }: { hovered?: boolean }) {
  return [sectionKitStyles.checkRow, Boolean(hovered) && styles.hoverable];
}

function jobRowPressableStyle({ hovered }: { hovered?: boolean }) {
  return [styles.pipelineJobRow, Boolean(hovered) && styles.hoverable];
}

function refreshButtonStyle({
  hovered = false,
  pressed = false,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.refreshButton, (hovered || pressed) && styles.refreshButtonHovered];
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
  },
  scroll: {
    flex: 1,
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 28,
    marginBottom: theme.spacing[2],
    gap: theme.spacing[2],
  },
  branchLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    flexShrink: 1,
  },
  refreshButton: {
    marginLeft: "auto",
    width: 22,
    height: 22,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  refreshButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  refreshIcon: {
    width: ICON_SIZE.md,
    height: ICON_SIZE.md,
    alignItems: "center",
    justifyContent: "center",
  },
  hoverable: {
    backgroundColor: theme.colors.surface1,
  },
  pipelineStageHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
  pipelineStageName: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    flexShrink: 1,
  },
  pipelineJobRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    paddingRight: theme.spacing[3],
    paddingLeft: theme.spacing[6],
    minHeight: 32,
  },
}));
