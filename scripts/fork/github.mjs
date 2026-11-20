export function parseGitHubRepo(url) {
  const match = url.match(
    /^(?:https:\/\/|ssh:\/\/)?(?:[^@/]+@)?github\.com[:/](?<repo>[^/]+\/[^/]+?)(?:\.git)?$/,
  );
  if (!match) throw new Error(`origin is not a github.com repository: ${url}`);
  return match.groups.repo;
}
