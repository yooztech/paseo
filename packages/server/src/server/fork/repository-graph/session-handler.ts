import type {
  CheckoutRepositoryGraphGetCommitDetailsRequest,
  CheckoutRepositoryGraphGetHistoryRequest,
  CheckoutRepositoryGraphMutateRefRequest,
  SessionOutboundMessage,
} from "@getpaseo/protocol/messages";
import { toCheckoutError } from "../../checkout-git-utils.js";
import { assertSafeGitRef } from "../../worktree-session.js";
import { expandTilde } from "../../../utils/path.js";
import {
  getRepositoryGraphCommitDetails,
  getRepositoryGraphHistory,
  mutateRepositoryGraphRef,
} from "./git.js";

export class RepositoryGraphForkSessionHandler {
  constructor(
    private readonly emit: (message: SessionOutboundMessage) => void,
    private readonly onMutation: (cwd: string) => Promise<void>,
    private readonly onRefreshError: (error: unknown, cwd: string) => void,
  ) {}

  async handleHistory(msg: CheckoutRepositoryGraphGetHistoryRequest): Promise<void> {
    const { cwd, limit, requestId } = msg;
    try {
      const history = await getRepositoryGraphHistory({ cwd: expandTilde(cwd), limit });
      this.emit({
        type: "checkout.repository_graph.get_history.response",
        payload: { cwd, ...history, error: null, requestId },
      });
    } catch (error) {
      this.emit({
        type: "checkout.repository_graph.get_history.response",
        payload: { cwd, commits: [], hasMore: false, error: toCheckoutError(error), requestId },
      });
    }
  }

  async handleCommitDetails(msg: CheckoutRepositoryGraphGetCommitDetailsRequest): Promise<void> {
    const { cwd, sha, requestId } = msg;
    try {
      assertSafeGitRef(sha, "commit");
      const details = await getRepositoryGraphCommitDetails({ cwd: expandTilde(cwd), sha });
      this.emit({
        type: "checkout.repository_graph.get_commit_details.response",
        payload: { cwd, sha, details, error: null, requestId },
      });
    } catch (error) {
      this.emit({
        type: "checkout.repository_graph.get_commit_details.response",
        payload: { cwd, sha, details: null, error: toCheckoutError(error), requestId },
      });
    }
  }

  async handleMutateRef(msg: CheckoutRepositoryGraphMutateRefRequest): Promise<void> {
    const {
      cwd,
      action,
      refKind,
      name,
      newName,
      targetSha,
      force,
      deleteOnRemote,
      pushToRemote,
      requestId,
    } = msg;
    try {
      assertSafeGitRef(name, refKind === "tag" ? "tag" : "branch");
      if (newName) {
        assertSafeGitRef(newName, refKind === "tag" ? "tag" : "branch");
      }
      if (targetSha) {
        assertSafeGitRef(targetSha, "commit");
      }
      await mutateRepositoryGraphRef({
        cwd: expandTilde(cwd),
        action,
        refKind,
        name,
        newName,
        targetSha,
        force,
        deleteOnRemote,
        pushToRemote,
      });
    } catch (error) {
      this.emit({
        type: "checkout.repository_graph.mutate_ref.response",
        payload: {
          cwd,
          action,
          refKind,
          name,
          success: false,
          error: toCheckoutError(error),
          requestId,
        },
      });
      return;
    }

    try {
      await this.onMutation(cwd);
    } catch (error) {
      try {
        this.onRefreshError(error, cwd);
      } catch {
        // Logging failures must not change the result of an already-applied Git mutation.
      }
    }

    this.emit({
      type: "checkout.repository_graph.mutate_ref.response",
      payload: { cwd, action, refKind, name, success: true, error: null, requestId },
    });
  }
}
