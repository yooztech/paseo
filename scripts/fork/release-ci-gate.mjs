#!/usr/bin/env node
// Tag-triggered release gate: fail when the tagged commit has no completed,
// successful ci.yml run on the patch branch. Mirrors the preflight gate in
// scripts/fork/release/release.mjs. Runs from the checked-out canonical tree,
// so it needs no materialized fork runtime.
import { pathToFileURL } from "node:url";
import { requirePassingCi } from "./release/ci-gate.mjs";
import { PATCH_BRANCH } from "./source.mjs";

function fail(message) {
  throw new Error(message);
}

function usage() {
  return `Usage: node scripts/fork/release-ci-gate.mjs --sha <commit> [--repo <owner/name>] [--branch <branch>]

Fails unless <commit> has a completed, successful ci.yml run on <branch>
(default ${PATCH_BRANCH}). --repo defaults to $GITHUB_REPOSITORY.`;
}

function parse(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--help" || flag === "-h") return { help: true };
    if (!["--sha", "--repo", "--branch"].includes(flag)) fail(`unknown argument: ${flag}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) fail(`missing value for ${flag}`);
    options[flag.slice(2)] = value;
    index += 1;
  }
  if (!options.sha) fail("--sha is required");
  return options;
}

export function main(args = process.argv.slice(2), env = process.env) {
  let options;
  try {
    options = parse(args);
    if (options.help) {
      console.log(usage());
      return;
    }
    const repo = options.repo ?? env.GITHUB_REPOSITORY;
    if (!repo) fail("--repo is required outside GitHub Actions");
    requirePassingCi({ sha: options.sha, repo, branch: options.branch ?? PATCH_BRANCH });
  } catch (error) {
    console.error(`release-ci-gate: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
