export const repositoryGraphQueryKind = "repositoryGraph";

export function repositoryGraphQueryKey(serverId: string, cwd: string) {
  return [repositoryGraphQueryKind, serverId, cwd] as const;
}

export function repositoryGraphCommitDetailsQueryKey(serverId: string, cwd: string, sha: string) {
  return ["repositoryGraphCommitDetails", serverId, cwd, sha] as const;
}
