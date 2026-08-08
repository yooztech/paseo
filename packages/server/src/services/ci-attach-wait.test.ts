import { describe, expect, it } from "vitest";
import {
  CI_ATTACH_POLL_INTERVAL_MS,
  CI_ATTACH_WAIT_MS,
  isCiAttachWaitActive,
  nextCiAttachWaitUntilMs,
  observeCiAttachWaitUntilMs,
  pullRequestHasAttachedCi,
  pullRequestNeedsCiAttachWait,
} from "./ci-attach-wait";

describe("ci-attach-wait", () => {
  it("treats an empty PR as needing an attach wait", () => {
    expect(
      pullRequestNeedsCiAttachWait({
        number: 12,
        url: "https://gitlab.example/mr/12",
        checksStatus: "none",
        checks: [],
      }),
    ).toBe(true);
    expect(pullRequestHasAttachedCi({ number: 12, checksStatus: "none", checks: [] })).toBe(false);
  });

  it("treats GitLab pipeline id as attached CI even when checks are empty", () => {
    expect(
      pullRequestHasAttachedCi({
        number: 12,
        checksStatus: "none",
        checks: [],
        forgeSpecific: { forge: "gitlab", pipelineId: 99, pipelineStatus: "running" },
      }),
    ).toBe(true);
  });

  it("treats pending or listed checks as attached CI", () => {
    expect(pullRequestHasAttachedCi({ checksStatus: "pending", checks: [] })).toBe(true);
    expect(
      pullRequestHasAttachedCi({
        checksStatus: "none",
        checks: [{ status: "pending" }],
      }),
    ).toBe(true);
  });

  it("arms a wait once per PR and keeps the deadline", () => {
    const first = nextCiAttachWaitUntilMs({
      previousWaitUntilMs: null,
      previousPrKey: null,
      status: { number: 7, url: "https://example/mr/7", checksStatus: "none", checks: [] },
      nowMs: 1_000,
    });
    expect(first).toEqual({ waitUntilMs: 1_000 + CI_ATTACH_WAIT_MS, prKey: "n:7" });

    const second = nextCiAttachWaitUntilMs({
      previousWaitUntilMs: first.waitUntilMs,
      previousPrKey: first.prKey,
      status: { number: 7, url: "https://example/mr/7", checksStatus: "none", checks: [] },
      nowMs: 10_000,
    });
    expect(second.waitUntilMs).toBe(first.waitUntilMs);
  });

  it("observe clears attach wait when CI appears without arming a new one", () => {
    expect(
      observeCiAttachWaitUntilMs({
        previousWaitUntilMs: null,
        previousPrKey: null,
        status: { number: 7, checksStatus: "none", checks: [] },
      }),
    ).toEqual({ waitUntilMs: null, prKey: "n:7" });

    expect(
      observeCiAttachWaitUntilMs({
        previousWaitUntilMs: 50_000,
        previousPrKey: "n:7",
        status: { number: 7, checksStatus: "none", checks: [] },
      }),
    ).toEqual({ waitUntilMs: 50_000, prKey: "n:7" });

    expect(
      observeCiAttachWaitUntilMs({
        previousWaitUntilMs: 50_000,
        previousPrKey: "n:7",
        status: { number: 7, checksStatus: "pending", checks: [] },
      }),
    ).toEqual({ waitUntilMs: null, prKey: "n:7" });
  });

  it("clears the wait once CI attaches and re-arms for a new PR", () => {
    const cleared = nextCiAttachWaitUntilMs({
      previousWaitUntilMs: 50_000,
      previousPrKey: "n:7",
      status: { number: 7, checksStatus: "pending", checks: [] },
      nowMs: 20_000,
    });
    expect(cleared).toEqual({ waitUntilMs: null, prKey: "n:7" });

    const rearmed = nextCiAttachWaitUntilMs({
      previousWaitUntilMs: null,
      previousPrKey: "n:7",
      status: { number: 8, checksStatus: "none", checks: [] },
      nowMs: 30_000,
    });
    expect(rearmed).toEqual({ waitUntilMs: 30_000 + CI_ATTACH_WAIT_MS, prKey: "n:8" });
  });

  it("reports active wait only before the deadline", () => {
    expect(isCiAttachWaitActive(100, 99)).toBe(true);
    expect(isCiAttachWaitActive(100, 100)).toBe(false);
    expect(isCiAttachWaitActive(null, 50)).toBe(false);
    expect(CI_ATTACH_POLL_INTERVAL_MS).toBe(5_000);
  });
});
