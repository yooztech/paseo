// Hard release gate: a fork release tag may only be created when the exact HEAD
// commit has a completed, successful ci.yml run on downstream/patch-build.
import { execFileSync } from "node:child_process";
import { PATCH_BRANCH } from "../source.mjs";

export const RELEASE_CI_WORKFLOW = "ci.yml";

const MAX_DESCRIBED_RUNS = 5;

export function selectPassingCiRun(runs, { sha, branch = PATCH_BRANCH } = {}) {
  return (
    runs.find(
      (run) =>
        run.head_sha === sha &&
        run.head_branch === branch &&
        run.path === ".github/workflows/ci.yml" &&
        run.status === "completed" &&
        run.conclusion === "success",
    ) ?? null
  );
}

export function describeCiRuns(runs) {
  if (!runs.length) return "none";
  const described = runs.slice(0, MAX_DESCRIBED_RUNS).map((run) => {
    const state = run.status === "completed" ? run.conclusion : run.status;
    return `#${run.run_number ?? run.id} ${state} (${run.head_branch})`;
  });
  if (runs.length > MAX_DESCRIBED_RUNS) described.push("…");
  return described.join(", ");
}

export function ghApi(path) {
  let stdout;
  try {
    stdout = execFileSync("gh", ["api", path, "-H", "Accept: application/vnd.github+json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    if (error.code === "ENOENT") return curlApi(path);
    const detail = `${error.stderr ?? error.message}`.trim();
    throw new Error(`gh api ${path} failed; cannot verify release CI: ${detail}`, { cause: error });
  }
  const output = stdout.trim();
  return output ? JSON.parse(output) : null;
}

// The self-hosted macOS runner may not have the GitHub CLI; curl is always present.
function curlApi(path) {
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (!token) throw new Error(`gh is not installed and no GH_TOKEN is set for ${path}`);
  let stdout;
  try {
    stdout = execFileSync(
      "curl",
      [
        "--fail",
        "--silent",
        "--show-error",
        "--header",
        "Accept: application/vnd.github+json",
        "--header",
        `Authorization: Bearer ${token}`,
        `https://api.github.com/${path}`,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    const detail = `${error.stderr ?? error.message}`.trim();
    throw new Error(`GitHub API ${path} failed; cannot verify release CI: ${detail}`, {
      cause: error,
    });
  }
  const output = stdout.trim();
  return output ? JSON.parse(output) : null;
}

export function requirePassingCi({ sha, repo, branch = PATCH_BRANCH, api = ghApi }) {
  const path = `repos/${repo}/actions/workflows/${RELEASE_CI_WORKFLOW}/runs?head_sha=${sha}&per_page=20`;
  const data = api(path);
  const runs = data?.workflow_runs ?? [];
  const run = selectPassingCiRun(runs, { sha, branch });
  if (run) {
    console.log(`Verified ${RELEASE_CI_WORKFLOW} success for ${sha}: ${run.html_url}`);
    return run;
  }
  throw new Error(
    `Release aborted: no successful "${RELEASE_CI_WORKFLOW}" run for ${sha} on ${branch}.\n` +
      `Runs for this commit: ${describeCiRuns(runs)}.\n` +
      "Run `npm run ci-patch-build`, wait for it to pass, then retry the release.",
  );
}
