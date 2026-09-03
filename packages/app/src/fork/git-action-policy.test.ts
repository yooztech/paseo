import { describe, expect, it } from "vitest";
import type { GitActionId } from "../git/policy";
import { buildForkGitActions, type ForkBuildGitActionsInput } from "./git-action-policy";

const ACTION_IDS: GitActionId[] = [
  "commit",
  "pull",
  "push",
  "pull-and-push",
  "pr",
  "merge-pr-squash",
  "merge-pr-merge",
  "merge-pr-rebase",
  "enable-pr-auto-merge-squash",
  "enable-pr-auto-merge-merge",
  "enable-pr-auto-merge-rebase",
  "disable-pr-auto-merge",
  "merge-branch",
  "merge-from-base",
  "archive-workspace",
];

function createInput(overrides: Partial<ForkBuildGitActionsInput> = {}): ForkBuildGitActionsInput {
  const runtime = Object.fromEntries(
    ACTION_IDS.map((id) => [id, { disabled: false, status: "idle" as const, handler: () => {} }]),
  ) as ForkBuildGitActionsInput["runtime"];

  return {
    isGit: true,
    githubFeaturesEnabled: true,
    forgeBrandLabel: "GitHub",
    forgeChangeRequestNoun: "PR",
    githubAutoMergeActionsEnabled: false,
    hasPullRequest: false,
    pullRequestUrl: null,
    pullRequestState: null,
    pullRequestIsDraft: false,
    pullRequestIsMerged: false,
    pullRequestMergeable: "UNKNOWN",
    pullRequestChecksStatus: undefined,
    prCreationPending: false,
    mergeCapability: null,
    hasRemote: false,
    isPaseoOwnedWorktree: true,
    isOnBaseBranch: true,
    hasUncommittedChanges: false,
    baseRefAvailable: true,
    baseRefLabel: "main",
    aheadCount: 0,
    contentDiff: { hasChangesFromBase: false },
    behindBaseCount: 0,
    aheadOfOrigin: 0,
    behindOfOrigin: 0,
    shouldPromoteArchive: false,
    shipDefault: "pr",
    runtime,
    ...overrides,
  };
}

function mergeablePullRequest(
  overrides: Partial<ForkBuildGitActionsInput> = {},
): ForkBuildGitActionsInput {
  return createInput({
    hasPullRequest: true,
    pullRequestUrl: "https://github.com/getpaseo/paseo/pull/1",
    pullRequestState: "open",
    pullRequestMergeable: "MERGEABLE",
    isOnBaseBranch: false,
    aheadCount: 1,
    contentDiff: { hasChangesFromBase: true },
    ...overrides,
  });
}

describe("fork git action policy", () => {
  it("removes the upstream archive action", () => {
    const actions = buildForkGitActions(createInput());

    expect(actions.primary).toBeNull();
    expect(actions.secondary.map((action) => action.id)).not.toContain("archive-workspace");
  });

  it("uses content difference instead of commit ancestry", () => {
    const actions = buildForkGitActions(
      createInput({
        isOnBaseBranch: false,
        aheadCount: 1,
        contentDiff: { hasChangesFromBase: false },
        shipDefault: "merge",
      }),
    );

    expect(actions.primary?.id).not.toBe("merge-branch");
  });

  it("defers merge actions while pull request checks are attaching", () => {
    const actions = buildForkGitActions(
      mergeablePullRequest({ pullRequestChecksStatus: "pending" }),
    );

    expect(actions.primary?.id).not.toMatch(/^merge-pr-/);
  });

  it("defaults direct pull request merges to merge commits", () => {
    const actions = buildForkGitActions(mergeablePullRequest());

    expect(actions.primary?.id).toBe("merge-pr-merge");
  });
});
