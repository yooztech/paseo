import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
  })?.trim();
}

function capture(command, args) {
  return run(command, args, { capture: true });
}

const branch = capture("git", ["branch", "--show-current"]);
if (branch !== "main") {
  throw new Error(`Fork releases must run from main, got ${branch || "detached HEAD"}.`);
}

if (capture("git", ["status", "--porcelain"])) {
  throw new Error("Fork releases require a clean worktree.");
}

run("git", ["fetch", "origin", "main", "--tags"]);

const head = capture("git", ["rev-parse", "HEAD"]);
const originMain = capture("git", ["rev-parse", "origin/main"]);
if (head !== originMain) {
  throw new Error("HEAD must match origin/main before creating a fork release.");
}

console.log("Installing locked release dependencies...");
run("npm", ["ci", "--loglevel=error", "--no-audit", "--no-fund"]);

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const prefix = `v${version}-fork.`;
const numbers = capture("git", ["tag", "--list", `${prefix}*`])
  .split("\n")
  .filter(Boolean)
  .map((tag) => tag.match(new RegExp(`^${prefix.replaceAll(".", "\\.")}(\\d+)(?:-app)?$`)))
  .filter(Boolean)
  .map((match) => Number(match[1]));
const tag = `${prefix}${Math.max(0, ...numbers) + 1}`;

console.log(`Building server for ${tag}...`);
run("npm", ["run", "build:server"]);
run("git", ["tag", tag]);

try {
  run("git", ["push", "origin", tag]);
} catch (error) {
  run("git", ["tag", "--delete", tag]);
  throw error;
}

console.log(`Published ${tag}. Restarting paseo.service...`);
run("systemctl", ["--user", "restart", "paseo.service"]);
console.log(`${tag} published and paseo.service restarted.`);
