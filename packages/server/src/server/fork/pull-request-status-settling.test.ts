import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceGitRuntimeSnapshot } from "../workspace-git-service.js";
import { settleCreatedPullRequestStatus } from "./pull-request-status-settling.js";

const cwd = "/tmp/request-worktree";
const created = {
  number: 2,
  url: "https://github.com/getpaseo/paseo/pull/2",
  title: "Update file",
  baseRef: "main",
};

function snapshotWithPullRequest(
  pullRequest: WorkspaceGitRuntimeSnapshot["forge"]["pullRequest"],
): WorkspaceGitRuntimeSnapshot {
  return {
    cwd,
    git: {
      isGit: true,
      repoRoot: cwd,
      mainRepoRoot: null,
      currentBranch: "feature",
      remoteUrl: "https://github.com/getpaseo/paseo.git",
      isPaseoOwnedWorktree: true,
      isDirty: false,
      baseRef: "main",
      aheadBehind: { ahead: 1, behind: 0 },
      aheadOfOrigin: 0,
      behindOfOrigin: 0,
      hasRemote: true,
      diffStat: null,
    },
    forge: {
      featuresEnabled: true,
      authState: "authenticated",
      forge: "github",
      pullRequest,
      error: null,
    },
  };
}

describe("settleCreatedPullRequestStatus", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("polls full forge status until mergeability and CI are authoritative", async () => {
    const workspaceGitService = {
      invalidateForge: vi.fn(),
      getSnapshot: vi
        .fn()
        .mockResolvedValueOnce(snapshotWithPullRequest(null))
        .mockResolvedValueOnce(
          snapshotWithPullRequest({
            number: 2,
            url: created.url,
            title: created.title,
            state: "open",
            baseRefName: "main",
            headRefName: "feature",
            isMerged: false,
            mergeable: "MERGEABLE",
            checks: [{ name: "tests", status: "pending", url: null }],
            checksStatus: "pending",
            reviewDecision: null,
          }),
        ),
    };

    const settling = settleCreatedPullRequestStatus({
      cwd,
      created,
      workspaceGitService,
      logger: { warn: vi.fn() },
    });
    await vi.runAllTimersAsync();
    await settling;

    expect(workspaceGitService.getSnapshot).toHaveBeenCalledTimes(2);
    expect(workspaceGitService.getSnapshot).toHaveBeenCalledWith(cwd, {
      force: true,
      includeForge: true,
      reason: "create-pr",
    });
  });

  it("stops after the bounded full-status retries fail", async () => {
    const workspaceGitService = {
      invalidateForge: vi.fn(),
      getSnapshot: vi.fn().mockRejectedValue(new Error("forge unavailable")),
    };
    const logger = { warn: vi.fn() };

    const settling = settleCreatedPullRequestStatus({
      cwd,
      created,
      workspaceGitService,
      logger,
    });
    await vi.runAllTimersAsync();
    await settling;

    expect(workspaceGitService.getSnapshot).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalled();
  });
});
