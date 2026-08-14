import { isAbsolute } from "node:path";
import type {
  CheckoutCommitFileDiffRequest,
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
  getRepositoryGraphFileDiff,
  getRepositoryGraphHistory,
  mutateRepositoryGraphRef,
} from "./git.js";

export class RepositoryGraphForkSessionHandler {
  constructor(
    private readonly emit: (message: SessionOutboundMessage) => void,
    private readonly onMutation: (cwd: string) => Promise<void>,
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

  async handleFileDiff(msg: CheckoutCommitFileDiffRequest): Promise<void> {
    const { cwd, sha, path, requestId } = msg;
    try {
      assertSafeGitRef(sha, "commit");
      if (path.length === 0 || isAbsolute(path) || path.split(/[\\/]/).includes("..")) {
        throw new Error(`Invalid path: ${path}`);
      }
      const file = await getRepositoryGraphFileDiff({ cwd: expandTilde(cwd), sha, path });
      this.emit({
        type: "checkout.commits.file_diff.response",
        payload: { cwd, sha, path, file, error: null, requestId },
      });
    } catch (error) {
      this.emit({
        type: "checkout.commits.file_diff.response",
        payload: { cwd, sha, path, file: null, error: toCheckoutError(error), requestId },
      });
    }
  }

  async handleMutateRef(msg: CheckoutRepositoryGraphMutateRefRequest): Promise<void> {
    const { cwd, action, refKind, name, newName, force, deleteOnRemote, requestId } = msg;
    let mutationError: unknown = null;
    try {
      assertSafeGitRef(name, refKind === "tag" ? "tag" : "branch");
      if (newName) {
        assertSafeGitRef(newName, refKind === "tag" ? "tag" : "branch");
      }
      await mutateRepositoryGraphRef({
        cwd: expandTilde(cwd),
        action,
        refKind,
        name,
        newName,
        force,
        deleteOnRemote,
      });
    } catch (error) {
      mutationError = error;
    }

    try {
      await this.onMutation(cwd);
    } catch (error) {
      mutationError ??= error;
    }

    if (!mutationError) {
      this.emit({
        type: "checkout.repository_graph.mutate_ref.response",
        payload: { cwd, action, refKind, name, success: true, error: null, requestId },
      });
      return;
    }
    this.emit({
      type: "checkout.repository_graph.mutate_ref.response",
      payload: {
        cwd,
        action,
        refKind,
        name,
        success: false,
        error: toCheckoutError(mutationError),
        requestId,
      },
    });
  }
}
