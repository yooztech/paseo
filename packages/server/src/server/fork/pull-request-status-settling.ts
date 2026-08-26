import type pino from "pino";
import { pullRequestHasAttachedCi } from "../../services/ci-attach-wait.js";
import type {
  CreatedPullRequestSnapshot,
  WorkspaceGitRuntimeSnapshot,
  WorkspaceGitService,
} from "../workspace-git-service.js";

const PR_CREATE_STATUS_POLL_INTERVAL_MS = 1_000;
const PR_CREATE_STATUS_SETTLE_TIMEOUT_MS = 2_000;

type PullRequestStatusSettlingService = Pick<
  WorkspaceGitService,
  "getSnapshot" | "invalidateForge"
>;

interface SettleCreatedPullRequestStatusOptions {
  cwd: string;
  created: Pick<CreatedPullRequestSnapshot, "number" | "url">;
  workspaceGitService: PullRequestStatusSettlingService;
  logger: Pick<pino.Logger, "warn">;
}

export async function settleCreatedPullRequestStatus({
  cwd,
  created,
  workspaceGitService,
  logger,
}: SettleCreatedPullRequestStatusOptions): Promise<void> {
  const initialSnapshot = await refreshCreatedPullRequestStatus({
    cwd,
    workspaceGitService,
    logger,
  });
  if (createdPullRequestStatusIsReady(initialSnapshot, created)) {
    return;
  }

  for (
    let elapsedMs = PR_CREATE_STATUS_POLL_INTERVAL_MS;
    elapsedMs <= PR_CREATE_STATUS_SETTLE_TIMEOUT_MS;
    elapsedMs += PR_CREATE_STATUS_POLL_INTERVAL_MS
  ) {
    await new Promise<void>((resolve) => setTimeout(resolve, PR_CREATE_STATUS_POLL_INTERVAL_MS));
    const snapshot = await refreshCreatedPullRequestStatus({ cwd, workspaceGitService, logger });
    if (createdPullRequestStatusIsReady(snapshot, created)) {
      return;
    }
  }
}

async function refreshCreatedPullRequestStatus({
  cwd,
  workspaceGitService,
  logger,
}: Omit<
  SettleCreatedPullRequestStatusOptions,
  "created"
>): Promise<WorkspaceGitRuntimeSnapshot | null> {
  try {
    workspaceGitService.invalidateForge(cwd);
    return await workspaceGitService.getSnapshot(cwd, {
      force: true,
      includeForge: true,
      reason: "create-pr",
    });
  } catch (error) {
    logger.warn(
      { err: error, cwd, reason: "create-pr" },
      "Failed to confirm pull request status after creation",
    );
    return null;
  }
}

function createdPullRequestStatusIsReady(
  snapshot: WorkspaceGitRuntimeSnapshot | null,
  created: Pick<CreatedPullRequestSnapshot, "number" | "url">,
): boolean {
  const status = snapshot?.forge.pullRequest;
  if (!status) {
    return false;
  }
  const matchesCreatedPullRequest =
    status.number === created.number || (status.number == null && status.url === created.url);
  return (
    matchesCreatedPullRequest &&
    status.mergeable != null &&
    status.mergeable !== "UNKNOWN" &&
    pullRequestHasAttachedCi(status)
  );
}
