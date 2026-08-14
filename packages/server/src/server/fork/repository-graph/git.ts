import type {
  ParsedDiffFile,
  RepositoryGraphCommit,
  RepositoryGraphCommitDetails,
} from "@getpaseo/protocol/messages";
import { parseAndHighlightDiff } from "../../utils/diff-highlighter.js";
import { repositoryGraphGitPrimitives } from "../../../utils/checkout-git.js";
import { runGitCommand } from "../../../utils/run-git-command.js";

const READ_ONLY_GIT_ENV = { GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" } as const;
const FIELD_SEPARATOR = "\x00";
const RECORD_SEPARATOR = "\x1e";
const LOG_FORMAT = "%x1e%H%x00%h%x00%P%x00%an%x00%aI%x00%s";
const DEFAULT_LIMIT = 200;
const ZERO_SHA = "0000000000000000000000000000000000000000";

interface RepositoryGraphRef {
  name: string;
  kind: "head" | "remote" | "tag";
  current: boolean;
  upstream?: string | null;
}

function parseRefs(stdout: string): Map<string, RepositoryGraphRef[]> {
  const refsBySha = new Map<string, RepositoryGraphRef[]>();
  for (const line of stdout.split("\n")) {
    const [objectSha = "", peeledSha = "", fullName = "", head = "", upstream = ""] =
      line.split("\x00");
    const sha = peeledSha || objectSha;
    let ref: RepositoryGraphRef | null = null;
    if (fullName.startsWith("refs/heads/")) {
      ref = {
        name: fullName.slice("refs/heads/".length),
        kind: "head",
        current: head === "*",
        ...(upstream ? { upstream } : {}),
      };
    } else if (fullName.startsWith("refs/remotes/") && !fullName.endsWith("/HEAD")) {
      ref = { name: fullName.slice("refs/remotes/".length), kind: "remote", current: false };
    } else if (fullName.startsWith("refs/tags/")) {
      ref = { name: fullName.slice("refs/tags/".length), kind: "tag", current: false };
    }
    if (!sha || !ref) {
      continue;
    }
    refsBySha.set(sha, [...(refsBySha.get(sha) ?? []), ref]);
  }
  return refsBySha;
}

function parseCommits(
  stdout: string,
  refsBySha: Map<string, RepositoryGraphRef[]>,
): RepositoryGraphCommit[] {
  const commits: RepositoryGraphCommit[] = [];
  for (const record of stdout.split(RECORD_SEPARATOR)) {
    if (!record) {
      continue;
    }
    const fields = record.replace(/^\n/, "").split(FIELD_SEPARATOR);
    const sha = (fields[0] ?? "").trim();
    if (!sha || fields.length < 6) {
      continue;
    }
    commits.push({
      sha,
      shortSha: (fields[1] ?? "").trim(),
      parents: (fields[2] ?? "").trim().split(" ").filter(Boolean),
      authorName: fields[3] ?? "",
      authorDate: (fields[4] ?? "").trim(),
      subject: (fields[5] ?? "").replace(/\n$/, ""),
      refs: refsBySha.get(sha) ?? [],
    });
  }
  return commits;
}

export async function getRepositoryGraphHistory({
  cwd,
  limit = DEFAULT_LIMIT,
}: {
  cwd: string;
  limit?: number;
}): Promise<{ commits: RepositoryGraphCommit[]; hasMore: boolean }> {
  const boundedLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
  const [logResult, refsResult] = await Promise.all([
    runGitCommand(
      [
        "log",
        `--max-count=${boundedLimit + 1}`,
        `--format=${LOG_FORMAT}`,
        "--date-order",
        "--branches",
        "--tags",
        "--remotes",
        "HEAD",
        "--",
      ],
      { cwd, envOverlay: READ_ONLY_GIT_ENV },
    ),
    runGitCommand(
      [
        "for-each-ref",
        "--format=%(objectname)%00%(*objectname)%00%(refname)%00%(HEAD)%00%(upstream:short)",
        "refs/heads",
        "refs/remotes",
        "refs/tags",
      ],
      { cwd, envOverlay: READ_ONLY_GIT_ENV },
    ),
  ]);
  if (logResult.truncated || refsResult.truncated) {
    throw new Error("Repository graph exceeded the git output limit");
  }
  const commits = parseCommits(logResult.stdout, parseRefs(refsResult.stdout));
  return { commits: commits.slice(0, boundedLimit), hasMore: commits.length > boundedLimit };
}

function parseRemoteBranch(name: string): { remote: string; branch: string } {
  const separator = name.indexOf("/");
  if (separator <= 0 || separator === name.length - 1) {
    throw new Error(`Invalid remote branch: ${name}`);
  }
  return { remote: name.slice(0, separator), branch: name.slice(separator + 1) };
}

async function getBranchUpstream(cwd: string, name: string): Promise<string | null> {
  const { stdout } = await runGitCommand(
    ["for-each-ref", "--format=%(upstream:short)", `refs/heads/${name}`],
    { cwd, envOverlay: READ_ONLY_GIT_ENV },
  );
  return stdout.trim() || null;
}

async function deleteRemoteBranch(cwd: string, name: string): Promise<void> {
  const { remote, branch } = parseRemoteBranch(name);
  await runGitCommand(["push", remote, "--delete", "--", branch], { cwd });
}

export interface RepositoryGraphRefMutation {
  cwd: string;
  action: "rename" | "delete";
  refKind: "head" | "remote" | "tag";
  name: string;
  newName?: string;
  force?: boolean;
  deleteOnRemote?: boolean;
}

export async function mutateRepositoryGraphRef(input: RepositoryGraphRefMutation): Promise<void> {
  if (input.action === "rename") {
    if (!input.newName) {
      throw new Error("A new reference name is required");
    }
    if (input.refKind === "head") {
      await runGitCommand(["branch", "-m", "--", input.name, input.newName], { cwd: input.cwd });
      return;
    }
    if (input.refKind === "tag") {
      await runGitCommand(
        ["update-ref", `refs/tags/${input.newName}`, `refs/tags/${input.name}`, ZERO_SHA],
        { cwd: input.cwd },
      );
      try {
        await runGitCommand(["tag", "-d", "--", input.name], { cwd: input.cwd });
      } catch (error) {
        await runGitCommand(["update-ref", "-d", `refs/tags/${input.newName}`], { cwd: input.cwd });
        throw error;
      }
      return;
    }
    throw new Error("Remote branches cannot be renamed");
  }

  if (input.refKind === "remote") {
    await deleteRemoteBranch(input.cwd, input.name);
    return;
  }
  if (input.refKind === "tag") {
    await runGitCommand(["tag", "-d", "--", input.name], { cwd: input.cwd });
    return;
  }

  const upstream = input.deleteOnRemote ? await getBranchUpstream(input.cwd, input.name) : null;
  if (input.deleteOnRemote && !upstream) {
    throw new Error(`Branch ${input.name} does not have an upstream branch`);
  }
  await runGitCommand(["branch", input.force ? "-D" : "-d", "--", input.name], {
    cwd: input.cwd,
  });
  if (upstream) {
    await deleteRemoteBranch(input.cwd, upstream);
  }
}

const DETAILS_FORMAT = ["%H", "%P", "%an", "%ae", "%aI", "%cn", "%ce", "%cI", "%s", "%b"].join(
  "%x1f",
);

export async function getRepositoryGraphCommitDetails({
  cwd,
  sha,
}: {
  cwd: string;
  sha: string;
}): Promise<RepositoryGraphCommitDetails> {
  const [metadataResult, records] = await Promise.all([
    runGitCommand(["show", "--quiet", `--format=${DETAILS_FORMAT}`, sha], {
      cwd,
      envOverlay: READ_ONLY_GIT_ENV,
    }),
    repositoryGraphGitPrimitives.getCommitRecords({ cwd, revision: sha, maxCount: 1 }),
  ]);
  const fields = metadataResult.stdout.replace(/\n$/, "").split("\x1f");
  if (fields.length < 10 || !fields[0]) {
    throw new Error(`Unable to parse commit details for ${sha}`);
  }
  return {
    sha: fields[0],
    parents: fields[1]?.split(" ").filter(Boolean) ?? [],
    authorName: fields[2] ?? "",
    authorEmail: fields[3] ?? "",
    authorDate: fields[4] ?? "",
    committerName: fields[5] ?? "",
    committerEmail: fields[6] ?? "",
    committerDate: fields[7] ?? "",
    subject: fields[8] ?? "",
    body: fields.slice(9).join("\x1f").trimEnd(),
    files: records[0]?.files ?? [],
  };
}

export async function getRepositoryGraphFileDiff({
  cwd,
  sha,
  path,
}: {
  cwd: string;
  sha: string;
  path: string;
}): Promise<ParsedDiffFile | null> {
  const { stdout } = await runGitCommand(
    ["show", sha, "--format=", "--diff-merges=first-parent", "--", path],
    { cwd, envOverlay: READ_ONLY_GIT_ENV },
  );
  if (stdout.trim().length === 0) {
    return null;
  }
  const files = await parseAndHighlightDiff(stdout, cwd, {
    getOldFileContent: (file) =>
      repositoryGraphGitPrimitives.readFileAtRef(cwd, `${sha}^`, file.path),
    getNewFileContent: (file) => repositoryGraphGitPrimitives.readFileAtRef(cwd, sha, file.path),
  });
  const file = files.find((candidate) => candidate.path === path) ?? null;
  return file?.hunks.length === 0 && /^Binary files .* differ$/m.test(stdout) ? null : file;
}
