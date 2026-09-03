import { buildGitActions, type BuildGitActionsInput, type GitActions } from "../git/policy";

export interface ForkBuildGitActionsInput extends BuildGitActionsInput {
  pullRequestChecksStatus?: string;
  prCreationPending: boolean;
  contentDiff?: {
    hasChangesFromBase?: boolean;
  };
}

function preferMergeCommit(
  input: ForkBuildGitActionsInput,
): BuildGitActionsInput["mergeCapability"] {
  const capability = input.mergeCapability;
  if (
    !capability ||
    capability.preferredMethod !== null ||
    !capability.allowedMethods.includes("merge")
  ) {
    return capability;
  }
  return { ...capability, preferredMethod: "merge" };
}

function preferDirectMergeAction(actions: GitActions, input: ForkBuildGitActionsInput): GitActions {
  if (
    input.mergeCapability?.preferredMethod != null ||
    (input.mergeCapability !== null && !input.mergeCapability.allowedMethods.includes("merge"))
  ) {
    return actions;
  }

  const mergeAction = actions.secondary.find((action) => action.id === "merge-pr-merge");
  if (!mergeAction) {
    return actions;
  }

  return {
    ...actions,
    primary:
      actions.primary?.id === "merge-pr-squash"
        ? { ...mergeAction, startsGroup: actions.primary.startsGroup }
        : actions.primary,
  };
}

function removeArchiveAction(actions: GitActions): GitActions {
  return {
    primary: actions.primary?.id === "archive-workspace" ? null : actions.primary,
    secondary: actions.secondary.filter((action) => action.id !== "archive-workspace"),
    menu: actions.menu.filter((action) => action.id !== "archive-workspace"),
  };
}

export function buildForkGitActions(input: ForkBuildGitActionsInput): GitActions {
  const hasChangesFromBase = input.contentDiff?.hasChangesFromBase ?? input.aheadCount > 0;
  const deferPullRequestActions =
    input.prCreationPending || input.pullRequestChecksStatus === "pending";

  const upstreamActions = buildGitActions({
    ...input,
    aheadCount: hasChangesFromBase ? Math.max(input.aheadCount, 1) : 0,
    pullRequestIsDraft: input.pullRequestIsDraft || deferPullRequestActions,
    mergeCapability: preferMergeCommit(input),
    shouldPromoteArchive: false,
  });

  return removeArchiveAction(preferDirectMergeAction(upstreamActions, input));
}
