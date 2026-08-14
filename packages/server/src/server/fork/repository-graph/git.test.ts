import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getRepositoryGraphCommitDetails,
  getRepositoryGraphHistory,
  mutateRepositoryGraphRef,
} from "./git.js";

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
  git(["config", "user.email", "test@test.com"], repoDir);
  git(["config", "user.name", "Test User"], repoDir);
  commitFile(repoDir, "README.md", "base\n", "Initial commit");
  return repoDir;
}

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
});
