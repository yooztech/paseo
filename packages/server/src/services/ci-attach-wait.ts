import { isGitLabStatusFacts } from "./gitlab-facts.js";
import type { ForgeSpecificStatusFacts } from "./forge-service.js";

export const CI_ATTACH_WAIT_MS = 60_000;
export const CI_ATTACH_POLL_INTERVAL_MS = 5_000;

export interface CiAttachStatusLike {
  number?: number;
  url?: string;
  checksStatus?: string;
  checks?: ReadonlyArray<{ status?: string }>;
  forgeSpecific?: ForgeSpecificStatusFacts | null;
}

/**
 * True once a PR/MR has any attached CI signal — checks rollup, pending/success/
 * failure status, or a GitLab head pipeline id.
 */
export function pullRequestHasAttachedCi(status: CiAttachStatusLike | null | undefined): boolean {
  if (!status) {
    return false;
  }
  if (
    status.checksStatus === "pending" ||
    status.checksStatus === "success" ||
    status.checksStatus === "failure"
  ) {
    return true;
  }
  if ((status.checks?.length ?? 0) > 0) {
    return true;
  }
  if (isGitLabStatusFacts(status.forgeSpecific)) {
    return status.forgeSpecific.pipelineId != null;
  }
  return false;
}

export function pullRequestNeedsCiAttachWait(
  status: CiAttachStatusLike | null | undefined,
): boolean {
  if (!status) {
    return false;
  }
  if (!status.url && status.number == null) {
    return false;
  }
  return !pullRequestHasAttachedCi(status);
}

/**
 * Clear or keep an existing attach-wait deadline. Does not arm a new wait —
 * that only happens after create-pr (see `nextCiAttachWaitUntilMs`).
 */
export function observeCiAttachWaitUntilMs(input: {
  previousWaitUntilMs: number | null;
  previousPrKey: string | null;
  status: CiAttachStatusLike | null | undefined;
}): { waitUntilMs: number | null; prKey: string | null } {
  const prKey = ciAttachPrKey(input.status);
  if (!prKey || !pullRequestNeedsCiAttachWait(input.status)) {
    return { waitUntilMs: null, prKey };
  }
  if (input.previousPrKey === prKey && input.previousWaitUntilMs != null) {
    return { waitUntilMs: input.previousWaitUntilMs, prKey };
  }
  return { waitUntilMs: null, prKey };
}

/**
 * Keep a per-PR wait deadline. Arms once when a PR first has no CI; clears when
 * CI appears or the PR identity changes. Call only from create-pr refresh.
 */
export function nextCiAttachWaitUntilMs(input: {
  previousWaitUntilMs: number | null;
  previousPrKey: string | null;
  status: CiAttachStatusLike | null | undefined;
  nowMs: number;
  waitMs?: number;
}): { waitUntilMs: number | null; prKey: string | null } {
  const prKey = ciAttachPrKey(input.status);
  if (!prKey || !pullRequestNeedsCiAttachWait(input.status)) {
    return { waitUntilMs: null, prKey };
  }

  const waitMs = input.waitMs ?? CI_ATTACH_WAIT_MS;
  if (input.previousPrKey === prKey && input.previousWaitUntilMs != null) {
    return { waitUntilMs: input.previousWaitUntilMs, prKey };
  }

  return { waitUntilMs: input.nowMs + waitMs, prKey };
}

export function isCiAttachWaitActive(
  waitUntilMs: number | null | undefined,
  nowMs: number,
): boolean {
  return typeof waitUntilMs === "number" && nowMs < waitUntilMs;
}

export function ciAttachPrKey(status: CiAttachStatusLike | null | undefined): string | null {
  if (!status) {
    return null;
  }
  if (status.number != null) {
    return `n:${status.number}`;
  }
  if (status.url) {
    return `u:${status.url}`;
  }
  return null;
}
