#!/usr/bin/env node
// Dispatch CI for the patched downstream branch and follow it to completion.
// One row per job: "<job> | <status> | <duration>", updated in place on a TTY.
import { execFileSync, spawnSync } from "node:child_process";
import { closeSync, openSync, writeSync } from "node:fs";
import tty from "node:tty";

const BRANCH = "downstream/patch-build";
const WORKFLOW = "ci.yml";
const POLL_MS = 5000;
const DISPATCH_WAIT_MS = 120_000;
const TIMEOUT_MS = 4 * 60 * 60 * 1000;
const ACTIVE = new Set(["queued", "in_progress", "requested", "waiting", "pending"]);
const STATUS_COLORS = {
  waiting: "\x1b[36m",
  running: "\x1b[33m",
  success: "\x1b[32m",
  failed: "\x1b[31m",
  cancelled: "\x1b[90m",
  skipped: "\x1b[90m",
};
const RESET = "\x1b[0m";

function fail(message) {
  throw new Error(message);
}

function command(file, args, { cwd, allowFailure = false } = {}) {
  const result = spawnSync(file, args, { cwd, encoding: "utf8" });
  if (result.error) fail(`${file} could not run: ${result.error.message}`);
  if (result.status !== 0 && !allowFailure) {
    fail(`${file} ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result;
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function remoteRepo() {
  const url = git("remote", "get-url", "origin");
  const match = url.match(
    /^(?:https:\/\/|ssh:\/\/)?(?:[^@/]+@)?github\.com[:/](?<repo>[^/]+\/[^/]+?)(?:\.git)?$/,
  );
  if (!match) fail(`origin is not a github.com repository: ${url}`);
  return match.groups.repo;
}

function api(path) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = command("gh", ["api", path, "-H", "Accept: application/vnd.github+json"], {
      allowFailure: true,
    });
    if (result.status === 0) return result.stdout.trim() ? JSON.parse(result.stdout) : null;
    lastError = (result.stderr || result.stdout).trim();
    if (attempt < 2) execFileSync("sleep", ["2"], { stdio: "ignore" });
  }
  fail(`gh api ${path} failed: ${lastError}`);
}

function workflowRuns(repo, sha) {
  const data = api(`repos/${repo}/actions/workflows/${WORKFLOW}/runs?head_sha=${sha}&per_page=20`);
  return (data?.workflow_runs ?? []).filter(
    (entry) => entry.head_branch === BRANCH && entry.path === `.github/workflows/${WORKFLOW}`,
  );
}

function runJobs(repo, runId) {
  const data = api(`repos/${repo}/actions/runs/${runId}/jobs?filter=latest&per_page=100`);
  return data?.jobs ?? [];
}

function progressStatus(item) {
  if (item.status !== "completed") return item.status === "in_progress" ? "running" : "waiting";
  if (item.conclusion === "success") return "success";
  if (item.conclusion === "cancelled") return "cancelled";
  if (item.conclusion === "skipped") return "skipped";
  return "failed";
}

function duration(item) {
  const start = Date.parse(item.started_at);
  if (Number.isNaN(start)) return "-";
  const end = item.completed_at ? Date.parse(item.completed_at) : Date.now();
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function fit(text, width) {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}

class Display {
  constructor() {
    this.fd = process.env.CI_PATCH_PLAIN_PROGRESS ? null : this.#tty();
    this.tty = this.fd !== null;
    this.lines = 0;
    this.previous = new Map();
  }

  #tty() {
    if (process.stdout.isTTY) return 1;
    try {
      const fd = openSync("/dev/tty", "w");
      if (tty.isatty(fd)) return fd;
      closeSync(fd);
      return null;
    } catch {
      // No controlling terminal; fall back to status changes on stdout.
      return null;
    }
  }

  write(text) {
    if (this.tty) writeSync(this.fd, text);
    else process.stdout.write(text);
  }

  update(jobs) {
    const rows = jobs.map((job) => [job.id, job.name, progressStatus(job), duration(job)]);
    if (!this.tty) {
      for (const [id, name, status, elapsed] of rows) {
        if (this.previous.get(id) === status) continue;
        console.log(`${name} | ${status} | ${elapsed}`);
        this.previous.set(id, status);
      }
      return;
    }
    const width = Math.max(1, (this.fd === 1 ? process.stdout.columns : 0) || 80) - 1;
    if (this.lines) this.write(`\x1b[${this.lines}A`);
    const count = Math.max(this.lines, rows.length);
    for (let index = 0; index < count; index += 1) {
      let line = "";
      if (index < rows.length) {
        const [, name, status, elapsed] = rows[index];
        const suffix = ` | ${status} | ${elapsed}`;
        const color = STATUS_COLORS[status] ?? "";
        line = `${fit(name, width - suffix.length)} | ${color}${status}${color ? RESET : ""} | ${elapsed}`;
      }
      this.write(`\r\x1b[2K${line}\n`);
    }
    if (count > rows.length) this.write(`\x1b[${count - rows.length}A`);
    this.lines = rows.length;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRun(repo, sha, knownIds, deadline) {
  while (Date.now() < deadline) {
    const fresh = workflowRuns(repo, sha).filter((entry) => !knownIds.has(entry.id));
    if (fresh.length > 1) fail("multiple new CI runs appeared for this commit; inspect Actions");
    if (fresh.length === 1) return fresh[0];
    await sleep(POLL_MS);
  }
  fail("timed out waiting for the dispatched CI run to appear");
}

async function watch(repo, run) {
  const deadline = Date.now() + TIMEOUT_MS;
  const display = new Display();
  while (Date.now() < deadline) {
    display.update(runJobs(repo, run.id));
    if (run.status === "completed") return run;
    await sleep(POLL_MS);
    run = api(`repos/${repo}/actions/runs/${run.id}`);
  }
  fail("timed out following the CI run; inspect Actions before retrying");
}

function report(run, jobs) {
  if (run.conclusion === "success") {
    const elapsed = duration({
      started_at: jobs.map((job) => job.started_at).sort()[0],
      completed_at: jobs
        .map((job) => job.completed_at)
        .sort()
        .at(-1),
    });
    console.log(`CI passed (${jobs.length} jobs, ${elapsed}): ${run.html_url}`);
    return;
  }
  const failed = jobs.filter((job) => progressStatus(job) === "failed");
  console.error(
    `CI ${progressStatus(run)}: ${failed.map((job) => job.name).join(", ")} — ${run.html_url}`,
  );
  process.exitCode = 1;
}

async function activeRun(repo, sha, waitMs) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const active = workflowRuns(repo, sha).filter((entry) => ACTIVE.has(entry.status));
    if (active.length) return active.at(-1);
    if (Date.now() >= deadline) return null;
    await sleep(1500);
  }
}

async function dispatch(repo, sha) {
  const branchTip = git("ls-remote", "--refs", "origin", `refs/heads/${BRANCH}`).split(/\s+/)[0];
  if (branchTip !== sha) {
    fail(`HEAD ${sha} is not origin/${BRANCH} (${branchTip || "missing"}); push first`);
  }
  const dirty = git("status", "--porcelain", "--untracked-files=no");
  if (dirty) fail(`commit local changes before dispatching CI:\n${dirty}`);
  const check = command("node", ["scripts/fork/upstream.mjs", "check"], { allowFailure: true });
  if (check.status !== 0) {
    fail(`fork patches do not replay against the pinned base:\n${check.stderr.trim()}`);
  }
  // A just-pushed commit starts a run on its own; attach to it instead of
  // dispatching a second run that the workflow concurrency group would cancel.
  const active = await activeRun(repo, sha, 15_000);
  if (active) return active;
  const known = new Set(workflowRuns(repo, sha).map((entry) => entry.id));
  command("gh", ["workflow", "run", WORKFLOW, "--repo", repo, "--ref", BRANCH]);
  return waitForRun(repo, sha, known, Date.now() + DISPATCH_WAIT_MS);
}

function resume(repo, runId) {
  const run = api(`repos/${repo}/actions/runs/${runId}`);
  if (
    run.path !== `.github/workflows/${WORKFLOW}` ||
    run.head_branch !== BRANCH ||
    !/^[0-9a-f]{40}$/.test(run.head_sha ?? "")
  ) {
    fail(`run ${runId} is not a ${WORKFLOW} run of ${BRANCH}`);
  }
  return run;
}

function usage() {
  return `Usage:
  node scripts/ci-patch-build.mjs            dispatch CI for HEAD and follow it
  node scripts/ci-patch-build.mjs --resume RUN_ID
                                             follow an existing CI run (read-only)

Runs ${WORKFLOW} on ${BRANCH}, one live row per job: name | status | duration.
Set CI_PATCH_PLAIN_PROGRESS=1 to log status changes instead of redrawing.`;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(usage());
    return;
  }
  let run;
  const repo = remoteRepo();
  if (args[0] === "--resume") {
    const runId = Number(args[1]);
    if (!Number.isInteger(runId) || runId <= 0 || args.length !== 2) {
      fail("--resume requires a positive run id");
    }
    run = resume(repo, runId);
  } else if (args.length) {
    fail(`unknown arguments: ${args.join(" ")}\n\n${usage()}`);
  } else {
    const sha = git("rev-parse", "HEAD");
    run = await dispatch(repo, sha);
  }
  const finished = await watch(repo, run);
  report(finished, runJobs(repo, finished.id));
}

try {
  await main();
} catch (error) {
  console.error(`ci-patch-build: ${error.message}`);
  process.exitCode = 1;
}
