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
  it("keeps Archive secondary instead of promoting it for an owned worktree", () => {
    const input = createInput();
    const actions = buildForkGitActions(input);

    expect(actions.primary).toBeNull();
    const archive = actions.secondary.filter((action) => action.id === "archive-workspace");
    expect(archive).toHaveLength(1);
    expect(archive[0]?.handler).toBe(input.runtime["archive-workspace"].handler);
  });

  it("keeps Archive available for directory workspaces", () => {
    const actions = buildForkGitActions(createInput({ isPaseoOwnedWorktree: false }));

    expect(actions.primary).toBeNull();
    expect(actions.secondary.at(-1)?.id).toBe("archive-workspace");
  });

  it.each([
    { aheadOfOrigin: 0, behindOfOrigin: 1, expectedPrimary: "pull" },
    { aheadOfOrigin: 1, behindOfOrigin: 0, expectedPrimary: "push" },
  ])("preserves Archive after a promoted $expectedPrimary", (scenario) => {
    const actions = buildForkGitActions(
      createInput({
        hasRemote: true,
        isPaseoOwnedWorktree: false,
        aheadOfOrigin: scenario.aheadOfOrigin,
        behindOfOrigin: scenario.behindOfOrigin,
        shouldPromoteArchive: true,
      }),
    );

    expect(actions.primary?.id).toBe(scenario.expectedPrimary);
    expect(actions.secondary.map((action) => action.id)).toEqual([
      "pull",
      "push",
      "pull-and-push",
      "archive-workspace",
    ]);
  });

  it("preserves Archive runtime availability", () => {
    const input = createInput();
    input.runtime["archive-workspace"] = {
      ...input.runtime["archive-workspace"],
      disabled: true,
      status: "pending",
    };

    const actions = buildForkGitActions(input);

    expect(actions.secondary.find((action) => action.id === "archive-workspace")).toMatchObject({
      disabled: true,
      status: "pending",
      handler: input.runtime["archive-workspace"].handler,
    });
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

  it("defaults direct pull request merges to merge commits", () => {
    const actions = buildForkGitActions(mergeablePullRequest());

    expect(actions.primary?.id).toBe("merge-pr-merge");
  });
});
