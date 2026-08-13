export const repositoryGraphQueryKind = "repositoryGraph";

export function repositoryGraphQueryKey(serverId: string, cwd: string) {
  return [repositoryGraphQueryKind, serverId, cwd] as const;
}
