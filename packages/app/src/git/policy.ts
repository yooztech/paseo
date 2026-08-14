import type { ReactElement } from "react";

import type { ActionStatus } from "@/components/ui/dropdown-menu";
import { i18n } from "@/i18n/i18next";
import type { CheckoutPrMergeMethod, PullRequestMergeable } from "@getpaseo/protocol/messages";

import type { MergeCapability } from "./merge-capability";

export type GitActionId =
  | "commit"
  | "pull"
  | "push"
  | "pull-and-push"
  | "pr"
  | "merge-pr-squash"
  | "merge-pr-merge"
  | "merge-pr-rebase"
  | "enable-pr-auto-merge-squash"
  | "enable-pr-auto-merge-merge"
  | "enable-pr-auto-merge-rebase"
  | "disable-pr-auto-merge"
  | "merge-branch"
  | "merge-from-base"
  | "archive-workspace";

export interface GitAction {
  id: GitActionId;
  label: string;
  pendingLabel: string;
  successLabel: string;
  disabled: boolean;
  status: ActionStatus;
  unavailableMessage?: string;
  icon?: ReactElement;
  /** When true, a menu separator should be rendered before this item. */
  startsGroup: boolean;
  handler: () => void;
}

export interface GitActions {
  primary: GitAction | null;
  secondary: GitAction[];
  menu: GitAction[];
}

interface GitActionRuntimeState {
  disabled: boolean;
  status: ActionStatus;
  icon?: ReactElement;
  handler: () => void;
}

export interface BuildGitActionsInput {
  isGit: boolean;
  githubFeaturesEnabled: boolean;
  /** Forge brand label (e.g. "GitHub", "GitLab") for forge-neutral unavailable copy. */
  forgeBrandLabel: string;
  /** Short change-request noun label (e.g. "PR", "MR") for forge-neutral unavailable copy. */
  forgeChangeRequestNoun: string;
  githubAutoMergeActionsEnabled: boolean;
  hasPullRequest: boolean;
  pullRequestUrl: string | null;
  pullRequestState: "open" | "closed" | null;
  pullRequestIsDraft: boolean;
  pullRequestIsMerged: boolean;
  pullRequestMergeable: PullRequestMergeable;
  pullRequestChecksStatus?: string;
  prCreationPending: boolean;
  mergeCapability: MergeCapability | null;
  hasRemote: boolean;
  isPaseoOwnedWorktree: boolean;
  isOnBaseBranch: boolean;
  hasUncommittedChanges: boolean;
  baseRefAvailable: boolean;
  baseRefLabel: string;
  aheadCount: number;
  contentDiff?: {
    hasChangesFromBase?: boolean;
  };
  behindBaseCount: number;
  aheadOfOrigin: number | null;
  behindOfOrigin: number | null;
  shipDefault: "merge" | "pr";
  runtime: Record<GitActionId, GitActionRuntimeState>;
}

export interface GitActionPolicy {
  hasChangesFromBase(input: BuildGitActionsInput): boolean;
  shouldDeferPullRequestActions(input: BuildGitActionsInput): boolean;
  hasPendingPullRequestChecks(input: BuildGitActionsInput): boolean;
  isPullRequestMergeable(input: BuildGitActionsInput): boolean;
  pullRequestViewLabel(input: BuildGitActionsInput): "view" | "conflict";
}

interface ResolvedBuildGitActionsInput extends BuildGitActionsInput {
  hasChangesFromBase: boolean;
  pullRequestActionsDeferred: boolean;
  hasPendingPullRequestChecks: boolean;
  isPullRequestMergeable: boolean;
  pullRequestViewLabel: "view" | "conflict";
}

export const defaultGitActionPolicy: GitActionPolicy = {
  hasChangesFromBase: (input) => input.aheadCount > 0,
  shouldDeferPullRequestActions: () => false,
  hasPendingPullRequestChecks: () => false,
  isPullRequestMergeable: (input) => input.pullRequestMergeable !== "CONFLICTING",
  pullRequestViewLabel: () => "view",
};

type PullRequestActionId = Extract<
  GitActionId,
  | "pr"
  | "merge-pr-squash"
  | "merge-pr-merge"
  | "merge-pr-rebase"
  | "enable-pr-auto-merge-squash"
  | "enable-pr-auto-merge-merge"
  | "enable-pr-auto-merge-rebase"
  | "disable-pr-auto-merge"
>;
type PullRequestDirectMergeActionId = Extract<
  GitActionId,
  "merge-pr-squash" | "merge-pr-merge" | "merge-pr-rebase"
>;
type PullRequestAutoMergeEnableActionId = Extract<
  GitActionId,
  "enable-pr-auto-merge-squash" | "enable-pr-auto-merge-merge" | "enable-pr-auto-merge-rebase"
>;
type PullRequestActionRole = "status" | "direct" | "auto";

interface PullRequestActionModel {
  readonly id: PullRequestActionId;
  readonly role: PullRequestActionRole;
  readonly build: (input: ResolvedBuildGitActionsInput) => GitAction;
}

interface PullRequestDirectMergeActionModel {
  readonly id: PullRequestDirectMergeActionId;
  readonly role: "direct";
  readonly method: CheckoutPrMergeMethod;
  readonly startsGroup: boolean;
}

interface PullRequestAutoMergeEnableActionModel {
  readonly id: PullRequestAutoMergeEnableActionId;
  readonly role: "auto";
  readonly method: CheckoutPrMergeMethod;
  readonly startsGroup: boolean;
}

const PULL_REQUEST_DIRECT_MERGE_ACTION_MODELS = [
  {
    id: "merge-pr-merge",
    role: "direct",
    method: "merge",
    startsGroup: true,
  },
  {
    id: "merge-pr-squash",
    role: "direct",
    method: "squash",
    startsGroup: false,
  },
  {
    id: "merge-pr-rebase",
    role: "direct",
    method: "rebase",
    startsGroup: false,
  },
] as const satisfies readonly PullRequestDirectMergeActionModel[];

const PULL_REQUEST_AUTO_MERGE_ENABLE_ACTION_MODELS = [
  {
    id: "enable-pr-auto-merge-squash",
    role: "auto",
    method: "squash",
    startsGroup: true,
  },
  {
    id: "enable-pr-auto-merge-merge",
    role: "auto",
    method: "merge",
    startsGroup: false,
  },
  {
    id: "enable-pr-auto-merge-rebase",
    role: "auto",
    method: "rebase",
    startsGroup: false,
  },
] as const satisfies readonly PullRequestAutoMergeEnableActionModel[];

const PULL_REQUEST_ACTION_MODELS: readonly PullRequestActionModel[] = [
  { id: "pr", role: "status", build: buildPrAction },
  ...PULL_REQUEST_DIRECT_MERGE_ACTION_MODELS.map((model) => ({
    ...model,
    build: (input: ResolvedBuildGitActionsInput) => buildDirectPullRequestMergeAction(input, model),
  })),
  ...PULL_REQUEST_AUTO_MERGE_ENABLE_ACTION_MODELS.map((model) => ({
    ...model,
    build: (input: ResolvedBuildGitActionsInput) =>
      buildEnablePullRequestAutoMergeAction(input, model),
  })),
  {
    id: "disable-pr-auto-merge",
    role: "auto",
    build: buildDisablePullRequestAutoMergeAction,
  },
];

const REMOTE_ACTION_IDS: GitActionId[] = ["pull", "push", "pull-and-push"];

export function narrowPullRequestState(state: string | null | undefined): "open" | "closed" | null {
  if (state === "open") return "open";
  if (state === "closed") return "closed";
  return null;
}

export function buildGitActions(
  input: BuildGitActionsInput,
  policy: GitActionPolicy = defaultGitActionPolicy,
): GitActions {
  if (!input.isGit) {
    return { primary: null, secondary: [], menu: [] };
  }

  const resolvedInput: ResolvedBuildGitActionsInput = {
    ...input,
    hasChangesFromBase: policy.hasChangesFromBase(input),
    pullRequestActionsDeferred: policy.shouldDeferPullRequestActions(input),
    hasPendingPullRequestChecks: policy.hasPendingPullRequestChecks(input),
    isPullRequestMergeable: policy.isPullRequestMergeable(input),
    pullRequestViewLabel: policy.pullRequestViewLabel(input),
  };

  const allActions = new Map<GitActionId, GitAction>();

  allActions.set("commit", {
    id: "commit",
    label: i18n.t("workspace.git.actions.commit.label"),
    pendingLabel: i18n.t("workspace.git.actions.commit.pending"),
    successLabel: i18n.t("workspace.git.actions.commit.success"),
    disabled: resolvedInput.runtime.commit.disabled,
    status: resolvedInput.runtime.commit.status,
    icon: resolvedInput.runtime.commit.icon,
    startsGroup: false,
    handler: resolvedInput.runtime.commit.handler,
  });

  allActions.set("pull", {
    id: "pull",
    label: i18n.t("workspace.git.actions.pull.label"),
    pendingLabel: i18n.t("workspace.git.actions.pull.pending"),
    successLabel: i18n.t("workspace.git.actions.pull.success"),
    disabled: resolvedInput.runtime.pull.disabled,
    status: resolvedInput.runtime.pull.status,
    unavailableMessage: resolvedInput.runtime.pull.disabled
      ? undefined
      : getPullUnavailableMessage(resolvedInput),
    icon: resolvedInput.runtime.pull.icon,
    startsGroup: false,
    handler: resolvedInput.runtime.pull.handler,
  });

  allActions.set("push", {
    id: "push",
    label: i18n.t("workspace.git.actions.push.label"),
    pendingLabel: i18n.t("workspace.git.actions.push.pending"),
    successLabel: i18n.t("workspace.git.actions.push.success"),
    disabled: resolvedInput.runtime.push.disabled,
    status: resolvedInput.runtime.push.status,
    unavailableMessage: resolvedInput.runtime.push.disabled
      ? undefined
      : getPushUnavailableMessage(resolvedInput),
    icon: resolvedInput.runtime.push.icon,
    startsGroup: false,
    handler: resolvedInput.runtime.push.handler,
  });

  allActions.set("pull-and-push", {
    id: "pull-and-push",
    label: i18n.t("workspace.git.actions.pullAndPush.label"),
    pendingLabel: i18n.t("workspace.git.actions.pullAndPush.pending"),
    successLabel: i18n.t("workspace.git.actions.pullAndPush.success"),
    disabled: resolvedInput.runtime["pull-and-push"].disabled,
    status: resolvedInput.runtime["pull-and-push"].status,
    unavailableMessage: resolvedInput.runtime["pull-and-push"].disabled
      ? undefined
      : getPullAndPushUnavailableMessage(resolvedInput),
    icon: resolvedInput.runtime["pull-and-push"].icon,
    startsGroup: false,
    handler: resolvedInput.runtime["pull-and-push"].handler,
  });

  for (const model of PULL_REQUEST_ACTION_MODELS) {
    allActions.set(model.id, model.build(resolvedInput));
  }

  allActions.set("merge-branch", {
    id: "merge-branch",
    label: i18n.t("workspace.git.actions.mergeBranch.label"),
    pendingLabel: i18n.t("workspace.git.actions.mergeBranch.pending"),
    successLabel: i18n.t("workspace.git.actions.mergeBranch.success"),
    disabled: resolvedInput.runtime["merge-branch"].disabled,
    status: resolvedInput.runtime["merge-branch"].status,
    unavailableMessage: resolvedInput.runtime["merge-branch"].disabled
      ? undefined
      : getMergeBranchUnavailableMessage(resolvedInput),
    icon: resolvedInput.runtime["merge-branch"].icon,
    startsGroup: false,
    handler: resolvedInput.runtime["merge-branch"].handler,
  });

  allActions.set("merge-from-base", {
    id: "merge-from-base",
    label: i18n.t("workspace.git.actions.mergeFromBase.label", { baseRef: input.baseRefLabel }),
    pendingLabel: i18n.t("workspace.git.actions.mergeFromBase.pending"),
    successLabel: i18n.t("workspace.git.actions.mergeFromBase.success"),
    disabled: resolvedInput.runtime["merge-from-base"].disabled,
    status: resolvedInput.runtime["merge-from-base"].status,
    unavailableMessage: resolvedInput.runtime["merge-from-base"].disabled
      ? undefined
      : getMergeFromBaseUnavailableMessage(resolvedInput),
    icon: resolvedInput.runtime["merge-from-base"].icon,
    startsGroup: true,
    handler: resolvedInput.runtime["merge-from-base"].handler,
  });

  const primaryActionId = getPrimaryActionId(resolvedInput);
  const primary = primaryActionId ? (allActions.get(primaryActionId) ?? null) : null;

  const secondaryIds = [...REMOTE_ACTION_IDS];
  if (!resolvedInput.isOnBaseBranch) {
    secondaryIds.push(...getFeatureActionIds(resolvedInput));
  }

  return {
    primary,
    secondary: secondaryIds.map((id) => allActions.get(id)!),
    menu: [],
  };
}

function getPrimaryActionId(input: ResolvedBuildGitActionsInput): GitActionId | null {
  if (input.hasUncommittedChanges) {
    return "commit";
  }
  if (canPull(input)) {
    return "pull";
  }
  if (canPush(input)) {
    return "push";
  }
  if (canMergePr(input)) {
    return getDefaultDirectPullRequestMergeActionId(input);
  }
  if (canEnablePrAutoMerge(input)) {
    return getDefaultEnablePullRequestAutoMergeActionId(input);
  }
  if (hasEnabledPrAutoMerge(input)) {
    return "pr";
  }
  if (input.shipDefault === "pr" && canUsePullRequestActionAsShipDefault(input)) {
    return "pr";
  }
  if (!input.isOnBaseBranch && input.hasChangesFromBase) {
    return "merge-branch";
  }
  if (!input.isOnBaseBranch && canMergeFromBase(input)) {
    return "merge-from-base";
  }
  if (input.githubFeaturesEnabled && input.hasPullRequest && input.pullRequestUrl) {
    return "pr";
  }

  return null;
}

function getPullRequestActionIds(filter: {
  roles: readonly PullRequestActionRole[];
  input: ResolvedBuildGitActionsInput;
}): PullRequestActionId[] {
  return PULL_REQUEST_ACTION_MODELS.filter((model) => filter.roles.includes(model.role))
    .filter((model) => shouldShowPullRequestAction(filter.input, model.id))
    .map((model) => model.id);
}

function getFeatureActionIds(input: ResolvedBuildGitActionsInput): GitActionId[] {
  return [
    "merge-from-base",
    "merge-branch",
    ...getPullRequestActionIds({ roles: ["status", "direct", "auto"], input }),
  ];
}

function getDefaultDirectPullRequestMergeActionId(
  input: ResolvedBuildGitActionsInput,
): PullRequestDirectMergeActionId {
  return (
    getPreferredDirectPullRequestMergeActionModel(input)?.id ??
    PULL_REQUEST_DIRECT_MERGE_ACTION_MODELS[0].id
  );
}

function getDefaultEnablePullRequestAutoMergeActionId(
  input: ResolvedBuildGitActionsInput,
): PullRequestAutoMergeEnableActionId {
  return (
    getPreferredEnablePullRequestAutoMergeActionModel(input)?.id ??
    PULL_REQUEST_AUTO_MERGE_ENABLE_ACTION_MODELS[0].id
  );
}

function buildPrAction(input: ResolvedBuildGitActionsInput): GitAction {
  if (input.hasPullRequest && input.pullRequestUrl) {
    const label = i18n.t(
      input.pullRequestViewLabel === "conflict"
        ? "workspace.git.actions.viewPrConflict"
        : "workspace.git.actions.viewPr",
    );
    return {
      id: "pr",
      label,
      pendingLabel: label,
      successLabel: label,
      disabled: input.runtime.pr.disabled,
      status: input.runtime.pr.status,
      unavailableMessage:
        input.runtime.pr.disabled || input.githubFeaturesEnabled
          ? undefined
          : i18n.t("workspace.git.actions.unavailable.viewPrNoForge", {
              brand: input.forgeBrandLabel,
              noun: input.forgeChangeRequestNoun,
            }),
      icon: input.runtime.pr.icon,
      startsGroup: false,
      handler: input.runtime.pr.handler,
    };
  }

  return {
    id: "pr",
    label: i18n.t("workspace.git.actions.createPr.label"),
    pendingLabel: i18n.t("workspace.git.actions.createPr.pending"),
    successLabel: i18n.t("workspace.git.actions.createPr.success"),
    disabled: input.runtime.pr.disabled,
    status: input.runtime.pr.status,
    unavailableMessage: input.runtime.pr.disabled
      ? undefined
      : getCreatePrUnavailableMessage(input),
    icon: input.runtime.pr.icon,
    startsGroup: false,
    handler: input.runtime.pr.handler,
  };
}

function buildDirectPullRequestMergeAction(
  input: ResolvedBuildGitActionsInput,
  model: PullRequestDirectMergeActionModel,
): GitAction {
  const runtime = input.runtime[model.id];
  const unavailableMessage = getMergePrUnavailableMessage(input);
  return {
    id: model.id,
    label: getDirectPullRequestMergeActionLabel(model.id),
    pendingLabel: i18n.t("workspace.git.actions.mergePr.pending"),
    successLabel: i18n.t("workspace.git.actions.mergePr.success"),
    disabled: runtime.disabled || shouldDisableMergePrAction(input),
    status: runtime.status,
    unavailableMessage: runtime.disabled ? undefined : unavailableMessage,
    icon: runtime.icon,
    startsGroup: model.startsGroup,
    handler: runtime.handler,
  };
}

function buildEnablePullRequestAutoMergeAction(
  input: ResolvedBuildGitActionsInput,
  model: PullRequestAutoMergeEnableActionModel,
): GitAction {
  const runtime = input.runtime[model.id];
  return {
    id: model.id,
    label: getEnablePullRequestAutoMergeActionLabel(model.id),
    pendingLabel: i18n.t("workspace.git.actions.autoMerge.enabling"),
    successLabel: i18n.t("workspace.git.actions.autoMerge.enabled"),
    disabled: runtime.disabled,
    status: runtime.status,
    icon: runtime.icon,
    startsGroup: model.startsGroup,
    handler: runtime.handler,
  };
}

function buildDisablePullRequestAutoMergeAction(input: ResolvedBuildGitActionsInput): GitAction {
  const runtime = input.runtime["disable-pr-auto-merge"];
  const unavailableMessage =
    input.mergeCapability?.canDisableAutoMerge === true
      ? undefined
      : i18n.t("workspace.git.actions.unavailable.autoMergeCannotDisable");
  return {
    id: "disable-pr-auto-merge",
    label: i18n.t("workspace.git.actions.autoMerge.enabled"),
    pendingLabel: i18n.t("workspace.git.actions.autoMerge.disabling"),
    successLabel: i18n.t("workspace.git.actions.autoMerge.disabled"),
    disabled: runtime.disabled || input.mergeCapability?.canDisableAutoMerge !== true,
    status: runtime.status,
    unavailableMessage: runtime.disabled ? undefined : unavailableMessage,
    icon: runtime.icon,
    startsGroup: true,
    handler: runtime.handler,
  };
}

function getDirectPullRequestMergeActionLabel(id: PullRequestDirectMergeActionId): string {
  switch (id) {
    case "merge-pr-squash":
      return i18n.t("workspace.git.actions.mergePr.squash");
    case "merge-pr-merge":
      return i18n.t("workspace.git.actions.mergePr.merge");
    case "merge-pr-rebase":
      return i18n.t("workspace.git.actions.mergePr.rebase");
  }
}

function getEnablePullRequestAutoMergeActionLabel(id: PullRequestAutoMergeEnableActionId): string {
  switch (id) {
    case "enable-pr-auto-merge-squash":
      return i18n.t("workspace.git.actions.autoMerge.enableSquash");
    case "enable-pr-auto-merge-merge":
      return i18n.t("workspace.git.actions.autoMerge.enableMerge");
    case "enable-pr-auto-merge-rebase":
      return i18n.t("workspace.git.actions.autoMerge.enableRebase");
  }
}

function canPull(input: ResolvedBuildGitActionsInput): boolean {
  return input.hasRemote && !input.hasUncommittedChanges && (input.behindOfOrigin ?? 0) > 0;
}

function canPush(input: ResolvedBuildGitActionsInput): boolean {
  return input.hasRemote && hasPushableCommits(input) && (input.behindOfOrigin ?? 0) === 0;
}

function hasPushableCommits(input: ResolvedBuildGitActionsInput): boolean {
  if ((input.aheadOfOrigin ?? 0) > 0) {
    return true;
  }
  // No-upstream Paseo worktrees are first-pushable: the daemon push sets upstream with `git push -u`.
  // Do not fold this into aheadOfOrigin; null also covers deleted/pruned upstream branches.
  return input.isPaseoOwnedWorktree && input.aheadOfOrigin === null && input.hasChangesFromBase;
}

function canMergeFromBase(input: ResolvedBuildGitActionsInput): boolean {
  return (
    !input.isOnBaseBranch &&
    input.baseRefAvailable &&
    !input.hasUncommittedChanges &&
    input.hasChangesFromBase &&
    input.behindBaseCount > 0
  );
}

function canUsePullRequestActionAsShipDefault(input: ResolvedBuildGitActionsInput): boolean {
  if (input.isOnBaseBranch || !input.githubFeaturesEnabled) {
    return false;
  }
  if (input.hasPullRequest) {
    return input.pullRequestUrl !== null;
  }
  return input.hasChangesFromBase;
}

function canMergePr(input: ResolvedBuildGitActionsInput): boolean {
  const capability = input.mergeCapability;
  const canMergeFromPullRequestStatus =
    input.githubFeaturesEnabled &&
    input.hasPullRequest &&
    input.pullRequestState === "open" &&
    !input.pullRequestIsDraft &&
    !input.pullRequestIsMerged &&
    !input.pullRequestActionsDeferred &&
    input.isPullRequestMergeable &&
    !input.hasPendingPullRequestChecks &&
    input.hasChangesFromBase &&
    !input.hasUncommittedChanges;

  if (!canMergeFromPullRequestStatus) {
    return false;
  }

  if (capability === null) {
    return (
      input.pullRequestMergeable === "MERGEABLE" &&
      input.behindOfOrigin === 0 &&
      input.aheadOfOrigin === 0 &&
      !canMergeFromBase(input)
    );
  }

  return (
    capability.directMergeReady &&
    !capability.autoMergeEnabled &&
    !capability.mergeBlockedByQueue &&
    getAllowedDirectPullRequestMergeActionModels(input).length > 0
  );
}

function canEnablePrAutoMerge(input: ResolvedBuildGitActionsInput): boolean {
  const capability = input.mergeCapability;
  return (
    input.githubFeaturesEnabled &&
    input.githubAutoMergeActionsEnabled &&
    input.hasPullRequest &&
    input.pullRequestState === "open" &&
    !input.pullRequestIsDraft &&
    !input.pullRequestIsMerged &&
    !input.pullRequestActionsDeferred &&
    input.isPullRequestMergeable &&
    capability !== null &&
    !capability.autoMergeEnabled &&
    capability.canEnableAutoMerge &&
    !capability.mergeBlockedByQueue &&
    getAllowedAutoMergeEnableActionModels(input).length > 0
  );
}

function hasEnabledPrAutoMerge(input: ResolvedBuildGitActionsInput): boolean {
  return (
    input.githubFeaturesEnabled &&
    input.hasPullRequest &&
    input.pullRequestUrl !== null &&
    input.mergeCapability?.autoMergeEnabled === true
  );
}

function getPullUnavailableMessage(input: ResolvedBuildGitActionsInput): string | undefined {
  if (!input.hasRemote) {
    return i18n.t("workspace.git.actions.unavailable.pullNoRemote");
  }
  if (input.hasUncommittedChanges) {
    return i18n.t("workspace.git.actions.unavailable.pullDirty");
  }
  if (input.behindOfOrigin === null) {
    return i18n.t("workspace.git.actions.unavailable.pullNoRemote");
  }
  if (input.behindOfOrigin === 0) {
    return i18n.t("workspace.git.actions.unavailable.pullUpToDate");
  }
  return undefined;
}

function getPushUnavailableMessage(input: ResolvedBuildGitActionsInput): string | undefined {
  if (!input.hasRemote) {
    return i18n.t("workspace.git.actions.unavailable.pushNoRemote");
  }
  if ((input.behindOfOrigin ?? 0) > 0) {
    return i18n.t("workspace.git.actions.unavailable.pushBehind");
  }
  if (!hasPushableCommits(input)) {
    return i18n.t("workspace.git.actions.unavailable.pushNothing");
  }
  return undefined;
}

function getPullAndPushUnavailableMessage(input: ResolvedBuildGitActionsInput): string | undefined {
  if (!input.hasRemote) {
    return i18n.t("workspace.git.actions.unavailable.pullAndPushNoRemote");
  }
  if (input.hasUncommittedChanges) {
    return i18n.t("workspace.git.actions.unavailable.pullAndPushDirty");
  }
  if (input.behindOfOrigin === null) {
    return i18n.t("workspace.git.actions.unavailable.pullAndPushNoIncoming");
  }
  if (input.behindOfOrigin === 0 && input.aheadOfOrigin === 0) {
    return i18n.t("workspace.git.actions.unavailable.pullAndPushInSync");
  }
  if (input.behindOfOrigin === 0) {
    return i18n.t("workspace.git.actions.unavailable.pullAndPushNoIncoming");
  }
  if ((input.aheadOfOrigin ?? 0) === 0) {
    return i18n.t("workspace.git.actions.unavailable.pullAndPushNothingToPush");
  }
  return undefined;
}

function getCreatePrUnavailableMessage(input: ResolvedBuildGitActionsInput): string | undefined {
  if (!input.githubFeaturesEnabled) {
    return i18n.t("workspace.git.actions.unavailable.createPrNoForge", {
      brand: input.forgeBrandLabel,
      noun: input.forgeChangeRequestNoun,
    });
  }
  if (!input.hasChangesFromBase) {
    return i18n.t("workspace.git.actions.unavailable.createPrNoCommits");
  }
  return undefined;
}

function getMergeBranchUnavailableMessage(input: ResolvedBuildGitActionsInput): string | undefined {
  if (!input.baseRefAvailable) {
    return i18n.t("workspace.git.actions.unavailable.mergeNoBase");
  }
  if (input.hasUncommittedChanges) {
    return i18n.t("workspace.git.actions.unavailable.mergeDirty");
  }
  if (!input.hasChangesFromBase) {
    return i18n.t("workspace.git.actions.unavailable.mergeNothing");
  }
  return undefined;
}

function getMergeFromBaseUnavailableMessage(
  input: ResolvedBuildGitActionsInput,
): string | undefined {
  if (!input.baseRefAvailable) {
    return i18n.t("workspace.git.actions.unavailable.updateNoBase");
  }
  if (input.hasUncommittedChanges) {
    return i18n.t("workspace.git.actions.unavailable.updateDirty");
  }
  if (input.behindBaseCount === 0 || !input.hasChangesFromBase) {
    return i18n.t("workspace.git.actions.unavailable.updateCurrent", {
      baseRef: input.baseRefLabel,
    });
  }
  return undefined;
}

function getMergePrUnavailableMessage(input: ResolvedBuildGitActionsInput): string | undefined {
  if (!input.githubFeaturesEnabled) {
    return i18n.t("workspace.git.actions.unavailable.mergePrNoForge", {
      brand: input.forgeBrandLabel,
      noun: input.forgeChangeRequestNoun,
    });
  }
  if (!input.hasPullRequest) {
    return i18n.t("workspace.git.actions.unavailable.mergePrMissing");
  }
  if (input.pullRequestIsDraft) {
    return i18n.t("workspace.git.actions.unavailable.mergePrDraft");
  }
  if (input.pullRequestIsMerged) {
    return i18n.t("workspace.git.actions.unavailable.mergePrMerged");
  }
  if (input.pullRequestState === "closed") {
    return i18n.t("workspace.git.actions.unavailable.mergePrClosed");
  }
  if (input.pullRequestMergeable === "CONFLICTING") {
    return i18n.t("workspace.git.actions.unavailable.mergePrConflicts");
  }
  if (input.mergeCapability === null) {
    return undefined;
  }
  if (input.mergeCapability.mergeBlockedByQueue) {
    return i18n.t("workspace.git.actions.unavailable.mergePrQueue");
  }
  if (!input.mergeCapability.directMergeReady) {
    return i18n.t("workspace.git.actions.unavailable.mergePrNotReady", {
      brand: input.forgeBrandLabel,
      noun: input.forgeChangeRequestNoun,
    });
  }
  return undefined;
}

function shouldDisableMergePrAction(input: ResolvedBuildGitActionsInput): boolean {
  return !canMergePr(input);
}

function shouldShowPullRequestAction(
  input: ResolvedBuildGitActionsInput,
  id: PullRequestActionId,
): boolean {
  if (id === "pr") {
    return true;
  }
  if (id === "disable-pr-auto-merge") {
    return input.githubAutoMergeActionsEnabled && input.mergeCapability?.autoMergeEnabled === true;
  }
  if (isDirectPullRequestMergeActionId(id)) {
    return canMergePr(input) && getAllowedDirectPullRequestMergeActionIds(input).includes(id);
  }
  if (isEnablePullRequestAutoMergeActionId(id)) {
    return canEnablePrAutoMerge(input) && getAllowedAutoMergeEnableActionIds(input).includes(id);
  }
  return false;
}

function isDirectPullRequestMergeActionId(
  id: PullRequestActionId,
): id is PullRequestDirectMergeActionId {
  return PULL_REQUEST_DIRECT_MERGE_ACTION_MODELS.some((model) => model.id === id);
}

function isEnablePullRequestAutoMergeActionId(
  id: PullRequestActionId,
): id is PullRequestAutoMergeEnableActionId {
  return PULL_REQUEST_AUTO_MERGE_ENABLE_ACTION_MODELS.some((model) => model.id === id);
}

function getAllowedDirectPullRequestMergeActionIds(
  input: ResolvedBuildGitActionsInput,
): PullRequestDirectMergeActionId[] {
  return getAllowedDirectPullRequestMergeActionModels(input).map((model) => model.id);
}

function getAllowedAutoMergeEnableActionIds(
  input: ResolvedBuildGitActionsInput,
): PullRequestAutoMergeEnableActionId[] {
  return getAllowedAutoMergeEnableActionModels(input).map((model) => model.id);
}

function getAllowedDirectPullRequestMergeActionModels(
  input: ResolvedBuildGitActionsInput,
): readonly PullRequestDirectMergeActionModel[] {
  return PULL_REQUEST_DIRECT_MERGE_ACTION_MODELS.filter((model) =>
    isPullRequestMergeMethodAllowed(input, model.method),
  );
}

function getAllowedAutoMergeEnableActionModels(
  input: ResolvedBuildGitActionsInput,
): readonly PullRequestAutoMergeEnableActionModel[] {
  return PULL_REQUEST_AUTO_MERGE_ENABLE_ACTION_MODELS.filter((model) =>
    isPullRequestMergeMethodAllowed(input, model.method),
  );
}

function getPreferredDirectPullRequestMergeActionModel(
  input: ResolvedBuildGitActionsInput,
): PullRequestDirectMergeActionModel | null {
  const allowed = getAllowedDirectPullRequestMergeActionModels(input);
  const preferred = input.mergeCapability?.preferredMethod ?? null;
  return allowed.find((model) => model.method === preferred) ?? allowed[0] ?? null;
}

function getPreferredEnablePullRequestAutoMergeActionModel(
  input: ResolvedBuildGitActionsInput,
): PullRequestAutoMergeEnableActionModel | null {
  const allowed = getAllowedAutoMergeEnableActionModels(input);
  const preferred = input.mergeCapability?.preferredMethod ?? null;
  return allowed.find((model) => model.method === preferred) ?? allowed[0] ?? null;
}

function isPullRequestMergeMethodAllowed(
  input: ResolvedBuildGitActionsInput,
  method: CheckoutPrMergeMethod,
): boolean {
  const capability = input.mergeCapability;
  if (capability === null) {
    return true;
  }
  return capability.allowedMethods.includes(method);
}
