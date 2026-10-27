import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGitHubService,
  type CurrentPullRequestStatus,
  type GitHubCommandRunner,
  type GitHubService,
} from "../../services/github-service.js";
import { getGitHubPollParentFallback } from "./github-poll-policy.js";

const origin = "yooztech/paseo";
const parent = { owner: { login: "getpaseo" }, name: "paseo" };
const branch = "feature/origin-pr";
const pending = { __typename: "StatusContext", context: "ci", state: "PENDING" };

function pr(repo: string, headRefName = branch) {
  return {
    number: 41,
    url: `https://github.com/${repo}/pull/41`,
    title: "Origin PR",
    state: "OPEN",
    isDraft: false,
    baseRefName: "main",
    headRefName,
    headRefOid: "head-sha",
    mergedAt: null,
    reviewDecision: null,
    mergeable: "MERGEABLE",
    headRepositoryOwner: { login: "yooztech" },
    statusCheckRollup: [pending],
  };
}

function harness() {
  let createdIn: string | null = null;
  const lookups: Array<{ repo: string; headRef: string }> = [];
  const checkQueries: string[] = [];
  const errors: unknown[] = [];
  const respond = async (args: string[]) => {
    if (args[0] === "pr" && args[1] === "view") {
      expect(args).toContain(origin);
      if (createdIn === origin && args[2] === branch) return JSON.stringify(pr(origin));
      throw Object.assign(new Error("no pull requests found"), {
        code: 1,
        stderr: "no pull requests found",
      });
    }
    if (args[0] === "repo" && args[1] === "view") {
      return JSON.stringify({ owner: { login: "yooztech" }, name: "paseo", isFork: true, parent });
    }
    if (args[0] === "api" && args[1]?.includes("/pulls")) return "[]";
    const query = args.find((arg) => arg.startsWith("query=")) ?? "";
    if (query.includes("query PullRequestStatusFacts")) {
      return JSON.stringify({ data: { repository: { pullRequest: {}, autoMergeAllowed: false } } });
    }
    if (query.includes("pullRequest(number:")) {
      checkQueries.push(query);
      const aliases: Record<string, unknown> = {};
      for (const match of query.matchAll(
        /(t\d+): repository\(owner: "([^"]+)", name: "([^"]+)"\)/g,
      )) {
        expect(`${match[2]}/${match[3]}`).toBe(createdIn);
        aliases[match[1]!] = {
          pullRequest: {
            commits: {
              nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [pending] } } } }],
            },
          },
        };
      }
      return JSON.stringify({ data: aliases });
    }
    const aliases: Record<string, unknown> = {};
    for (const match of query.matchAll(
      /(t\d+): repository\(owner: "([^"]+)", name: "([^"]+)"\)\s*\{[\s\S]*?headRefName: "([^"]+)"/g,
    )) {
      const repo = `${match[2]}/${match[3]}`;
      const headRef = match[4]!;
      lookups.push({ repo, headRef });
      aliases[match[1]!] = {
        owner: { login: match[2] },
        isFork: repo === origin,
        parent: repo === origin ? parent : null,
        pullRequests: { nodes: createdIn === repo && headRef === branch ? [pr(repo)] : [] },
      };
    }
    if (Object.keys(aliases).length === 0) throw new Error(`Unexpected CLI: ${args.join(" ")}`);
    return JSON.stringify({ data: aliases });
  };
  const runner: GitHubCommandRunner = async (args) => ({ stdout: await respond(args), stderr: "" });
  const service = createGitHubService({
    runner,
    ttlMs: 0,
    resolveGhPath: async () => "/fake/gh",
    resolveRepoHost: async () => null,
    resolveRepoSlug: async () => origin,
    now: () => Date.now(),
  });
  const retain = (headRef = branch) => {
    const statuses: Array<CurrentPullRequestStatus | null> = [];
    service.retainCurrentPullRequestStatusPoll?.({
      cwd: "/repo",
      headRef,
      onStatus: (status) => statuses.push(status),
      onError: (error) => errors.push(error),
    });
    return statuses;
  };
  return {
    service,
    retain,
    lookups,
    checkQueries,
    errors,
    createIn: (repo: string) => {
      createdIn = repo;
    },
  };
}

const activeServices: GitHubService[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  for (const service of activeServices.splice(0)) service.dispose?.();
  vi.useRealTimers();
});

function setup() {
  const fixture = harness();
  activeServices.push(fixture.service);
  return fixture;
}

async function tick(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

describe("fork GitHub origin-first polling", () => {
  it("keeps a newly created running origin PR after a manual refresh and the 20/25s poll", async () => {
    const fixture = setup();
    const statuses = fixture.retain();
    await tick();
    expect(fixture.errors).toEqual([]);
    expect(statuses).toEqual([null]);
    expect(fixture.lookups.map(({ repo }) => repo)).toEqual([origin, "getpaseo/paseo"]);
    fixture.createIn(origin);
    await tick(1);
    fixture.service.invalidate?.("/repo");
    const manual = await fixture.service.getCurrentPullRequestStatus({
      cwd: "/repo",
      headRef: branch,
    });
    expect(manual).toMatchObject({ number: 41, repoOwner: "yooztech", checksStatus: "pending" });
    await tick(20_000);
    await tick(5_000);
    expect(statuses.at(-1)).toMatchObject({
      number: 41,
      repoOwner: "yooztech",
      checksStatus: "pending",
    });
    expect(fixture.lookups.at(-1)).toEqual({ repo: origin, headRef: branch });
    expect(fixture.checkQueries.length).toBeGreaterThan(0);
    expect(fixture.errors).toEqual([]);
  });

  it("does not let a no-PR branch poison another branch's origin lookup", async () => {
    const fixture = setup();
    fixture.retain("feature/no-pr");
    await tick();
    fixture.createIn(origin);
    const statuses = fixture.retain();
    await tick();
    expect(fixture.errors).toEqual([]);
    expect(statuses.at(-1)).toMatchObject({ number: 41, repoOwner: "yooztech" });
    expect(fixture.lookups.filter(({ headRef }) => headRef === branch)).toEqual([
      { repo: origin, headRef: branch },
    ]);
    expect(fixture.errors).toEqual([]);
  });

  it("resolves a genuine parent PR with the fork owner and parent checks every cycle", async () => {
    const fixture = setup();
    fixture.createIn("getpaseo/paseo");
    const statuses = fixture.retain();
    await tick();
    await tick(25_000);
    expect(fixture.errors).toEqual([]);
    expect(fixture.lookups.map(({ repo }) => repo)).toEqual([
      origin,
      "getpaseo/paseo",
      origin,
      "getpaseo/paseo",
    ]);
    expect(statuses).toHaveLength(2);
    expect(
      statuses.every((status) => status?.repoOwner === "getpaseo" && status.number === 41),
    ).toBe(true);
    expect(fixture.checkQueries).toHaveLength(2);
    expect(fixture.errors).toEqual([]);
  });

  it("does not recursively redirect an already addressed parent", () => {
    expect(
      getGitHubPollParentFallback(
        { owner: "getpaseo", name: "paseo", headRepositoryOwner: "yooztech" },
        { isFork: true, parent: { owner: { login: "another" }, name: "paseo" } },
      ),
    ).toBeNull();
  });
});
