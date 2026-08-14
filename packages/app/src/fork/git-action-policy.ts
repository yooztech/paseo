import type { GitActionPolicy } from "../git/policy";

export const forkGitActionPolicy: GitActionPolicy = {
  hasChangesFromBase: (input) => input.contentDiff?.hasChangesFromBase ?? input.aheadCount > 0,
  shouldDeferPullRequestActions: (input) => input.prCreationPending,
  hasPendingPullRequestChecks: (input) => input.pullRequestChecksStatus === "pending",
  isPullRequestMergeable: (input) => input.pullRequestMergeable !== "CONFLICTING",
  pullRequestViewLabel: (input) =>
    input.pullRequestMergeable === "CONFLICTING" ? "conflict" : "view",
};
