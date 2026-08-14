import { isAbsolute } from "node:path";
import type {
  CheckoutCommitFileDiffRequest,
  CheckoutRepositoryGraphGetCommitDetailsRequest,
  CheckoutRepositoryGraphGetHistoryRequest,
  SessionOutboundMessage,
} from "@getpaseo/protocol/messages";
import { toCheckoutError } from "../../checkout-git-utils.js";
import { assertSafeGitRef } from "../../worktree-session.js";
import { expandTilde } from "../../../utils/path.js";
import {
  getRepositoryGraphCommitDetails,
  getRepositoryGraphFileDiff,
  getRepositoryGraphHistory,
} from "./git.js";

export class RepositoryGraphForkSessionHandler {
  constructor(private readonly emit: (message: SessionOutboundMessage) => void) {}

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
}
