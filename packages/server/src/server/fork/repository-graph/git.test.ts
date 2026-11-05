import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionOutboundMessage } from "@getpaseo/protocol/messages";
import {
  checkoutRepositoryGraph,
  getRepositoryGraphCommitDetails,
  getRepositoryGraphHistory,
  mutateRepositoryGraphRef,
} from "./git.js";
import { RepositoryGraphForkSessionHandler } from "./session-handler.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function commitFile(repoDir: string, name: string, content: string, message: string): string {
  writeFileSync(join(repoDir, name), content);
  git(["add", "."], repoDir);
  git(["-c", "commit.gpgsign=false", "commit", "-m", message], repoDir);
  return git(["rev-parse", "HEAD"], repoDir);
}

interface DatedGitCommand {
  args: string[];
  cwd: string;
  date: string;
}

function gitAtDate({ args, cwd, date }: DatedGitCommand): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  }).trim();
}

function commitFileAtDate(
  repoDir: string,
  name: string,
  content: string,
  message: string,
  date: string,
): string {
  writeFileSync(join(repoDir, name), content);
  git(["add", "."], repoDir);
  gitAtDate({
    args: ["-c", "commit.gpgsign=false", "commit", "-m", message],
    cwd: repoDir,
    date,
  });
  return git(["rev-parse", "HEAD"], repoDir);
}

function initRepo(): string {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "repository-graph-test-")));
  tempDirs.push(root);
  const repoDir = join(root, "repo");
  mkdirSync(repoDir);
  git(["init", "-b", "main"], repoDir);
  git(["config", "core.autocrlf", "false"], repoDir);
  git(["config", "user.email", "test@test.com"], repoDir);
  git(["config", "user.name", "Test User"], repoDir);
  commitFile(repoDir, "README.md", "base\n", "Initial commit");
  return repoDir;
}

describe("checkoutRepositoryGraph", () => {
  it.each([false, true])("detaches and reattaches in a linked worktree: %s", async (linked) => {
    const repoDir = initRepo();
    const baseSha = git(["rev-parse", "HEAD"], repoDir);
    const tipSha = commitFile(repoDir, "README.md", "tip\n", "Tip");
    git(["branch", "older", baseSha], repoDir);
    const cwd = linked ? join(repoDir, "../linked") : repoDir;
    const branch = linked ? "worktree-branch" : "main";
    if (linked) {
      git(["worktree", "add", "-b", branch, cwd], repoDir);
    }
    await checkoutRepositoryGraph({ cwd, target: { kind: "commit", sha: baseSha } });
    expect(git(["rev-parse", "HEAD"], cwd)).toBe(baseSha);
    expect((await getRepositoryGraphHistory({ cwd, limit: 1 })).checkout).toEqual({
      headSha: baseSha,
      currentBranch: null,
      localBranches: linked ? ["main", "older", "worktree-branch"] : ["main", "older"],
    });
    await checkoutRepositoryGraph({ cwd, target: { kind: "branch", name: branch } });
    expect(git(["symbolic-ref", "--short", "HEAD"], cwd)).toBe(branch);
    expect(git(["rev-parse", "HEAD"], cwd)).toBe(tipSha);
    expect(readFileSync(join(cwd, "README.md"), "utf8")).toBe("tip\n");
  });

  it("preserves HEAD and dirty files when checkout would overwrite changes", async () => {
    const cwd = initRepo();
    const baseSha = git(["rev-parse", "HEAD"], cwd);
    const tipSha = commitFile(cwd, "README.md", "tip\n", "Tip");
    writeFileSync(join(cwd, "README.md"), "dirty\n");
    await expect(
      checkoutRepositoryGraph({ cwd, target: { kind: "commit", sha: baseSha } }),
    ).rejects.toThrow();
    expect(git(["rev-parse", "HEAD"], cwd)).toBe(tipSha);
    expect(git(["symbolic-ref", "--short", "HEAD"], cwd)).toBe("main");
    expect(readFileSync(join(cwd, "README.md"), "utf8")).toBe("dirty\n");
  });

  it("rejects branches in another worktree without changing HEAD or files", async () => {
    const repoDir = initRepo();
    const cwd = join(repoDir, "../linked");
    git(["worktree", "add", "-b", "linked", cwd], repoDir);
    const sha = git(["rev-parse", "HEAD"], cwd);
    await checkoutRepositoryGraph({ cwd, target: { kind: "commit", sha } });
    await expect(
      checkoutRepositoryGraph({ cwd, target: { kind: "branch", name: "main" } }),
    ).rejects.toThrow();
    expect((await getRepositoryGraphHistory({ cwd })).checkout).toMatchObject({
      headSha: sha,
      currentBranch: null,
    });
    expect(readFileSync(join(cwd, "README.md"), "utf8")).toBe("base\n");
  });

  it("does not guess remote branches or interpret branch options", async () => {
    const cwd = initRepo();
    git(["update-ref", "refs/remotes/origin/remote-only", "HEAD"], cwd);
    for (const name of ["remote-only", "--detach", "main~1", "@{-1}"]) {
      await expect(
        checkoutRepositoryGraph({ cwd, target: { kind: "branch", name } }),
      ).rejects.toThrow();
    }
    expect(git(["symbolic-ref", "--short", "HEAD"], cwd)).toBe("main");
    expect(git(["for-each-ref", "--format=%(refname:short)", "refs/heads"], cwd)).toBe("main");
  });
});

describe("RepositoryGraphForkSessionHandler.handleCheckout", () => {
  it("correlates detach and reattach responses and refreshes successful mutations", async () => {
    const cwd = initRepo();
    const sha = git(["rev-parse", "HEAD"], cwd);
    const responses: SessionOutboundMessage[] = [];
    const refreshed: string[] = [];
    const handler = new RepositoryGraphForkSessionHandler(
      (message) => responses.push(message),
      async (path) => {
        refreshed.push(path);
      },
      () => {},
    );
    await handler.handleCheckout({
      type: "checkout.repository_graph.checkout.request",
      cwd,
      target: { kind: "commit", sha },
      requestId: "detach",
    });
    expect((await getRepositoryGraphHistory({ cwd })).checkout.currentBranch).toBeNull();
    await handler.handleCheckout({
      type: "checkout.repository_graph.checkout.request",
      cwd,
      target: { kind: "branch", name: "main" },
      requestId: "attach",
    });
    expect(responses).toEqual(
      ["detach", "attach"].map((requestId) => ({
        type: "checkout.repository_graph.checkout.response",
        payload: { cwd, success: true, error: null, requestId },
      })),
    );
    expect(refreshed).toEqual([cwd, cwd]);
    expect(git(["symbolic-ref", "--short", "HEAD"], cwd)).toBe("main");
  });

  it.each(["feature/c++", "工作分支"])("returns to Git-valid local branch %s", async (name) => {
    const cwd = initRepo();
    const sha = git(["rev-parse", "HEAD"], cwd);
    git(["branch", name], cwd);
    const responses: SessionOutboundMessage[] = [];
    const handler = new RepositoryGraphForkSessionHandler(
      (message) => responses.push(message),
      async () => {},
      () => {},
    );
    await handler.handleCheckout({
      type: "checkout.repository_graph.checkout.request",
      cwd,
      target: { kind: "commit", sha },
      requestId: "detach",
    });
    await handler.handleCheckout({
      type: "checkout.repository_graph.checkout.request",
      cwd,
      target: { kind: "branch", name },
      requestId: "return",
    });
    expect(git(["symbolic-ref", "--short", "HEAD"], cwd)).toBe(name);
    expect(git(["rev-parse", "HEAD"], cwd)).toBe(sha);
    expect(responses[1]).toEqual({
      type: "checkout.repository_graph.checkout.response",
      payload: { cwd, success: true, error: null, requestId: "return" },
    });
  });

  it("returns a correlated error without refreshing for invalid refs", async () => {
    const cwd = initRepo();
    const headSha = git(["rev-parse", "HEAD"], cwd);
    const responses: SessionOutboundMessage[] = [];
    let refreshCount = 0;
    const handler = new RepositoryGraphForkSessionHandler(
      (message) => responses.push(message),
      async () => {
        refreshCount += 1;
      },
      () => {},
    );
    await handler.handleCheckout({
      type: "checkout.repository_graph.checkout.request",
      cwd,
      target: { kind: "commit", sha: "--help" },
      requestId: "invalid",
    });
    expect(responses).toEqual([
      {
        type: "checkout.repository_graph.checkout.response",
        payload: {
          cwd,
          success: false,
          error: expect.objectContaining({ code: expect.any(String), message: expect.any(String) }),
          requestId: "invalid",
        },
      },
    ]);
    expect(refreshCount).toBe(0);
    expect(git(["symbolic-ref", "--short", "HEAD"], cwd)).toBe("main");
    expect(git(["rev-parse", "HEAD"], cwd)).toBe(headSha);
    expect(readFileSync(join(cwd, "README.md"), "utf8")).toBe("base\n");
  });

  it("reports successful checkout once even if refresh and refresh reporting fail", async () => {
    const cwd = initRepo();
    const responses: SessionOutboundMessage[] = [];
    const handler = new RepositoryGraphForkSessionHandler(
      (message) => responses.push(message),
      async () => {
        throw new Error("refresh failed");
      },
      () => {
        throw new Error("report failed");
      },
    );
    await handler.handleCheckout({
      type: "checkout.repository_graph.checkout.request",
      cwd,
      target: { kind: "commit", sha: git(["rev-parse", "HEAD"], cwd) },
      requestId: "refresh-error",
    });
    expect(responses).toEqual([
      {
        type: "checkout.repository_graph.checkout.response",
        payload: { cwd, success: true, error: null, requestId: "refresh-error" },
      },
    ]);
  });
});

describe("getRepositoryGraphHistory", () => {
  it("returns topo-ordered commits and associates branches and tags", async () => {
    const repoDir = initRepo();
    git(["checkout", "-b", "feature"], repoDir);
    const featureSha = commitFile(repoDir, "feature.txt", "feature\n", "Feature commit");
    git(["tag", "v1", featureSha], repoDir);
    git(["checkout", "main"], repoDir);
    commitFile(repoDir, "main.txt", "main\n", "Main commit");
    git(["merge", "--no-ff", "feature", "-m", "Merge feature"], repoDir);

    const result = await getRepositoryGraphHistory({ cwd: repoDir, limit: 20 });

    expect(result.hasMore).toBe(false);
    expect(result.commits[0]?.subject).toBe("Merge feature");
    expect(result.commits.slice(1, 3).map((commit) => commit.subject)).toEqual(
      expect.arrayContaining(["Main commit", "Feature commit"]),
    );
    expect(result.commits[3]?.subject).toBe("Initial commit");
    expect(result.commits[0]?.parents).toHaveLength(2);
    expect(result.commits[0]?.refs).toContainEqual({ name: "main", kind: "head", current: true });
    expect(result.commits.find((commit) => commit.sha === featureSha)?.refs).toEqual(
      expect.arrayContaining([
        { name: "feature", kind: "head", current: false },
        { name: "v1", kind: "tag", current: false },
      ]),
    );
  });

  it("reports when more commits exist than the requested limit", async () => {
    const repoDir = initRepo();
    commitFile(repoDir, "second.txt", "second\n", "Second commit");

    const result = await getRepositoryGraphHistory({ cwd: repoDir, limit: 1 });

    expect(result.hasMore).toBe(true);
    expect(result.commits).toHaveLength(1);
    expect(result.commits[0]?.subject).toBe("Second commit");
  });

  it("includes a detached HEAD commit that has no ref", async () => {
    const repoDir = initRepo();
    git(["checkout", "--detach"], repoDir);
    const detachedSha = commitFile(repoDir, "detached.txt", "detached\n", "Detached commit");

    const result = await getRepositoryGraphHistory({ cwd: repoDir, limit: 20 });

    expect(result.commits[0]?.sha).toBe(detachedSha);
    expect(result.commits[0]?.subject).toBe("Detached commit");
  });

  it("keeps a merge's first parent adjacent when sibling tips have the same date", async () => {
    const repoDir = initRepo();
    git(["checkout", "-b", "remote-line"], repoDir);
    commitFileAtDate(repoDir, "feature.txt", "feature\n", "Feature commit", "2030-01-01T00:01:00Z");
    const remoteTip = commitFileAtDate(
      repoDir,
      "remote.txt",
      "remote\n",
      "Remote tip",
      "2030-01-01T00:02:00Z",
    );
    git(["checkout", "main"], repoDir);
    const firstParent = commitFileAtDate(
      repoDir,
      "main.txt",
      "main\n",
      "First parent",
      "2030-01-01T00:02:00Z",
    );
    gitAtDate({
      args: ["-c", "commit.gpgsign=false", "merge", "--no-ff", "remote-line", "-m", "Top merge"],
      cwd: repoDir,
      date: "2030-01-01T00:03:00Z",
    });

    const result = await getRepositoryGraphHistory({ cwd: repoDir, limit: 20 });
    const commitRows = new Map(result.commits.map((commit, row) => [commit.sha, row]));

    expect(result.commits.slice(0, 3).map((commit) => commit.sha)).toEqual([
      git(["rev-parse", "HEAD"], repoDir),
      firstParent,
      remoteTip,
    ]);
    for (const [row, commit] of result.commits.entries()) {
      for (const parent of commit.parents) {
        const parentRow = commitRows.get(parent);
        if (parentRow !== undefined) {
          expect(parentRow).toBeGreaterThan(row);
        }
      }
    }
  });
});

describe("getRepositoryGraphCommitDetails", () => {
  it("returns commit metadata, body, and changed files", async () => {
    const repoDir = initRepo();
    writeFileSync(join(repoDir, "README.md"), "base\nchanged\n");
    writeFileSync(join(repoDir, "added.txt"), "added\n");
    git(["add", "."], repoDir);
    git(
      ["-c", "commit.gpgsign=false", "commit", "-m", "Detailed subject", "-m", "Detailed body"],
      repoDir,
    );
    const sha = git(["rev-parse", "HEAD"], repoDir);

    const details = await getRepositoryGraphCommitDetails({ cwd: repoDir, sha });

    expect(details).toMatchObject({
      sha,
      authorName: "Test User",
      authorEmail: "test@test.com",
      committerName: "Test User",
      subject: "Detailed subject",
      body: "Detailed body",
    });
    expect(details.parents).toHaveLength(1);
    expect(details.files).toEqual(
      expect.arrayContaining([
        { path: "README.md", additions: 1, deletions: 0, status: "modified" },
        { path: "added.txt", additions: 1, deletions: 0, status: "added" },
      ]),
    );
  });
});

describe("mutateRepositoryGraphRef", () => {
  it("renames and force deletes local branches", async () => {
    const repoDir = initRepo();
    git(["branch", "feature"], repoDir);

    await mutateRepositoryGraphRef({
      cwd: repoDir,
      action: "rename",
      refKind: "head",
      name: "feature",
      newName: "renamed-feature",
    });
    expect(git(["branch", "--format=%(refname:short)"], repoDir).split("\n")).toContain(
      "renamed-feature",
    );

    git(["checkout", "renamed-feature"], repoDir);
    commitFile(repoDir, "feature.txt", "feature\n", "Feature commit");
    git(["checkout", "main"], repoDir);
    await expect(
      mutateRepositoryGraphRef({
        cwd: repoDir,
        action: "delete",
        refKind: "head",
        name: "renamed-feature",
      }),
    ).rejects.toThrow();

    await mutateRepositoryGraphRef({
      cwd: repoDir,
      action: "delete",
      refKind: "head",
      name: "renamed-feature",
      force: true,
    });
    expect(git(["branch", "--format=%(refname:short)"], repoDir).split("\n")).not.toContain(
      "renamed-feature",
    );
  });

  it("renames tags without replacing annotated tag objects", async () => {
    const repoDir = initRepo();
    git(["tag", "-a", "v1", "-m", "Release v1"], repoDir);
    const tagObject = git(["rev-parse", "refs/tags/v1"], repoDir);

    await mutateRepositoryGraphRef({
      cwd: repoDir,
      action: "rename",
      refKind: "tag",
      name: "v1",
      newName: "v1-renamed",
    });

    expect(git(["rev-parse", "refs/tags/v1-renamed"], repoDir)).toBe(tagObject);
    expect(() => git(["rev-parse", "--verify", "refs/tags/v1"], repoDir)).toThrow();
  });

  it("deletes a local branch and its configured upstream", async () => {
    const repoDir = initRepo();
    const remoteDir = join(tempDirs[0] ?? "", "remote.git");
    git(["init", "--bare", remoteDir], repoDir);
    git(["remote", "add", "origin", remoteDir], repoDir);
    git(["checkout", "-b", "feature/remote"], repoDir);
    git(["push", "-u", "origin", "feature/remote"], repoDir);
    git(["checkout", "main"], repoDir);
    const history = await getRepositoryGraphHistory({ cwd: repoDir, limit: 20 });
    expect(history.commits[0]?.refs).toContainEqual({
      name: "feature/remote",
      kind: "head",
      current: false,
      upstream: "origin/feature/remote",
    });

    await mutateRepositoryGraphRef({
      cwd: repoDir,
      action: "delete",
      refKind: "head",
      name: "feature/remote",
      deleteOnRemote: true,
    });

    expect(git(["branch", "--format=%(refname:short)"], repoDir).split("\n")).not.toContain(
      "feature/remote",
    );
    expect(git(["ls-remote", "--heads", "origin", "feature/remote"], repoDir)).toBe("");
  });

  it("creates a tag on a commit without pushing when remote push is disabled", async () => {
    const repoDir = initRepo();
    const targetSha = git(["rev-parse", "HEAD"], repoDir);

    await mutateRepositoryGraphRef({
      cwd: repoDir,
      action: "create",
      refKind: "tag",
      name: "local-only",
      targetSha,
      pushToRemote: false,
    });

    expect(git(["rev-parse", "refs/tags/local-only"], repoDir)).toBe(targetSha);
  });

  it("pushes a created tag to origin and deletes it locally and remotely", async () => {
    const repoDir = initRepo();
    const remoteDir = join(tempDirs[0] ?? "", "tags-remote.git");
    git(["init", "--bare", remoteDir], repoDir);
    git(["remote", "add", "origin", remoteDir], repoDir);
    const targetSha = git(["rev-parse", "HEAD"], repoDir);

    await mutateRepositoryGraphRef({
      cwd: repoDir,
      action: "create",
      refKind: "tag",
      name: "v2",
      targetSha,
      pushToRemote: true,
    });
    expect(git(["ls-remote", "--tags", "origin", "v2"], repoDir)).toContain(targetSha);

    await mutateRepositoryGraphRef({
      cwd: repoDir,
      action: "delete",
      refKind: "tag",
      name: "v2",
      deleteOnRemote: true,
    });

    expect(() => git(["rev-parse", "--verify", "refs/tags/v2"], repoDir)).toThrow();
    expect(git(["ls-remote", "--tags", "origin", "v2"], repoDir)).toBe("");
  });
});

describe("RepositoryGraphForkSessionHandler.handleMutateRef", () => {
  it("reports a successful ref change once even when refresh fails", async () => {
    const repoDir = initRepo();
    git(["branch", "feature"], repoDir);
    const responses: SessionOutboundMessage[] = [];
    let refreshCount = 0;
    const refreshErrors: Array<{ error: unknown; cwd: string }> = [];
    const handler = new RepositoryGraphForkSessionHandler(
      (message) => responses.push(message),
      async () => {
        refreshCount++;
        throw new Error("refresh failed");
      },
      (error, cwd) => refreshErrors.push({ error, cwd }),
    );

    await handler.handleMutateRef({
      type: "checkout.repository_graph.mutate_ref.request",
      cwd: repoDir,
      action: "rename",
      refKind: "head",
      name: "feature",
      newName: "renamed-feature",
      requestId: "rename-ref",
    });

    expect(git(["branch", "--format=%(refname:short)"], repoDir).split("\n")).toContain(
      "renamed-feature",
    );
    expect(refreshCount).toBe(1);
    expect(refreshErrors).toEqual([{ error: new Error("refresh failed"), cwd: repoDir }]);
    expect(responses).toEqual([
      {
        type: "checkout.repository_graph.mutate_ref.response",
        payload: {
          cwd: repoDir,
          action: "rename",
          refKind: "head",
          name: "feature",
          success: true,
          error: null,
          requestId: "rename-ref",
        },
      },
    ]);
  });

  it("reports a genuine Git failure once without attempting refresh", async () => {
    const repoDir = initRepo();
    const responses: SessionOutboundMessage[] = [];
    let refreshCount = 0;
    const refreshErrors: Array<{ error: unknown; cwd: string }> = [];
    const handler = new RepositoryGraphForkSessionHandler(
      (message) => responses.push(message),
      async () => {
        refreshCount++;
        throw new Error("refresh failed");
      },
      (error, cwd) => refreshErrors.push({ error, cwd }),
    );

    await handler.handleMutateRef({
      type: "checkout.repository_graph.mutate_ref.request",
      cwd: repoDir,
      action: "rename",
      refKind: "head",
      name: "missing-branch",
      newName: "renamed-feature",
      requestId: "failed-rename",
    });

    expect(refreshCount).toBe(0);
    expect(refreshErrors).toEqual([]);
    expect(responses).toHaveLength(1);
    expect(responses[0]).toMatchObject({
      type: "checkout.repository_graph.mutate_ref.response",
      payload: {
        cwd: repoDir,
        action: "rename",
        refKind: "head",
        name: "missing-branch",
        success: false,
        error: { code: "UNKNOWN", message: expect.stringContaining("missing-branch") },
        requestId: "failed-rename",
      },
    });
    expect(git(["branch", "--format=%(refname:short)"], repoDir).split("\n")).not.toContain(
      "renamed-feature",
    );
  });
});
