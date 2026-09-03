import type { ForgeDefinition } from "../../forge-manifest.js";

interface SelfHostedForgeDefinition {
  id: string;
  hosts: readonly string[];
  webAuthorities: Readonly<Record<string, string>>;
}

const SELF_HOSTED_FORGE_DEFINITIONS: readonly SelfHostedForgeDefinition[] = [
  {
    id: "gitlab",
    hosts: ["gitlab.iceveil.com"],
    webAuthorities: { "gitlab.iceveil.com": "gitlab.iceveil.com:38443" },
  },
];

function getSelfHostedDefinition(id: string): SelfHostedForgeDefinition | undefined {
  return SELF_HOSTED_FORGE_DEFINITIONS.find((definition) => definition.id === id);
}

export function getForkForgeKnownHosts(definition: ForgeDefinition): readonly string[] {
  return [
    ...(definition.cloudHosts ?? []),
    ...(getSelfHostedDefinition(definition.id)?.hosts ?? []),
  ];
}

export function getForkForgeWebAuthority(forgeId: string, host: string): string | undefined {
  return getSelfHostedDefinition(forgeId)?.webAuthorities[host];
}
