/**
 * Declarative manifest of the git forges Paseo knows how to present, mirroring
 * provider-manifest.ts. Pure build-time data shared by BOTH the client (icon,
 * brand label, PR↔MR relabel) and the server (registry host-matching, prompt
 * branding). It is NEVER serialized over the wire, so adding a forge here is not
 * a protocol change.
 *
 * Keep this free of runtime dependencies: its only import is the fork-owned
 * declarative overlay. Behavioural concerns (CLI invocation, host probing, REST
 * adapters) live in the server adapter keyed by {@link ForgeDefinition.id}; this
 * file is only the declarative half.
 */
import { SELF_HOSTED_FORGE_MANIFEST_OVERLAY } from "./fork/forges/self-hosted.js";

/**
 * Declarative sign-in recipe for a forge. The client renders install/sign-in
 * hints from this data alone — no per-CLI switch — so a new forge wires its auth
 * UX entirely from the manifest. Behavioural auth (the actual host probe) stays
 * in the server adapter; this is only what the user is told to run.
 */
export interface ForgeSignInCommand {
  /** Binary the user installs, e.g. "gh" — shown in the install-CLI hint. */
  cli: string;
  /** Full sign-in command, e.g. "gh auth login". */
  command: string;
  /**
   * Flag that targets a self-hosted host, e.g. "--hostname". When present and a
   * host is known, the client appends `${command} ${hostnameFlag} ${host}`.
   * Omit when the command already targets the right host on its own.
   */
  hostnameFlag?: string;
}

export interface ForgeDefinition {
  /** Registry id, matches the server adapter and the wire `forge` value. */
  id: string;
  /** Human brand name, e.g. for "Open on GitLab". */
  displayName: string;
  /** Short change-request noun: "PR" for GitHub, "MR" for GitLab. */
  changeRequestAbbrev: string;
  /** Full change-request noun: "pull request" vs "merge request". */
  changeRequestNoun: string;
  /** Prefix before a change-request number: "#" vs "!". */
  changeRequestNumberPrefix: string;
  /** Prefix before an issue number ("#" on every forge so far). */
  issueNumberPrefix: string;
  /** Icon key; the client falls back to a generic git icon for unknown values. */
  iconKind: string;
  /** Sign-in recipe, or null when the forge has no Paseo-driven sign-in. */
  signIn: ForgeSignInCommand | null;
  /**
   * Public cloud hosts this forge owns exactly. A BOUNDED list, never an
   * allowlist for self-hosted detection — self-hosted/Enterprise instances are
   * recognized at runtime by the adapter's host probe, not by this field.
   */
  cloudHosts?: string[];
  /** Known self-hosted hosts that can be matched without runtime probing. */
  selfHostedHosts?: string[];
  /** Web authorities for known hosts that require a non-default browser origin. */
  webAuthorities?: Record<string, string>;
}

/**
 * Fork-owned additions may extend host aliases and web authorities, but cannot
 * replace a forge's shared presentation or authentication contract.
 */
export interface ForgeDefinitionOverlay {
  id: string;
  cloudHosts?: readonly string[];
  selfHostedHosts?: readonly string[];
  webAuthorities?: Readonly<Record<string, string>>;
}

export interface ForgeManifestOverlay {
  definitions: readonly ForgeDefinitionOverlay[];
}

function applyForgeManifestOverlays(
  definitions: ForgeDefinition[],
  overlays: readonly ForgeManifestOverlay[],
): ForgeDefinition[] {
  const overrides = new Map<string, ForgeDefinitionOverlay>();
  for (const overlay of overlays) {
    for (const override of overlay.definitions) {
      const existing = overrides.get(override.id);
      overrides.set(override.id, {
        id: override.id,
        cloudHosts: [...(existing?.cloudHosts ?? []), ...(override.cloudHosts ?? [])],
        selfHostedHosts: [
          ...(existing?.selfHostedHosts ?? []),
          ...(override.selfHostedHosts ?? []),
        ],
        webAuthorities: { ...existing?.webAuthorities, ...override.webAuthorities },
      });
    }
  }
  return definitions.map((definition) => {
    const override = overrides.get(definition.id);
    if (!override) {
      return definition;
    }
    return {
      ...definition,
      cloudHosts: override.cloudHosts?.length
        ? [...(definition.cloudHosts ?? []), ...override.cloudHosts]
        : definition.cloudHosts,
      selfHostedHosts: override.selfHostedHosts?.length
        ? [...(definition.selfHostedHosts ?? []), ...override.selfHostedHosts]
        : definition.selfHostedHosts,
      webAuthorities: Object.keys(override.webAuthorities ?? {}).length
        ? { ...definition.webAuthorities, ...override.webAuthorities }
        : definition.webAuthorities,
    };
  });
}

const DEFAULT_FORGE_DEFINITIONS: ForgeDefinition[] = [
  {
    id: "github",
    displayName: "GitHub",
    changeRequestAbbrev: "PR",
    changeRequestNoun: "pull request",
    changeRequestNumberPrefix: "#",
    issueNumberPrefix: "#",
    iconKind: "github",
    signIn: { cli: "gh", command: "gh auth login" },
    cloudHosts: ["github.com", "ssh.github.com"],
  },
  {
    id: "gitlab",
    displayName: "GitLab",
    changeRequestAbbrev: "MR",
    changeRequestNoun: "merge request",
    changeRequestNumberPrefix: "!",
    issueNumberPrefix: "#",
    iconKind: "gitlab",
    signIn: { cli: "glab", command: "glab auth login", hostnameFlag: "--hostname" },
    cloudHosts: ["gitlab.com"],
  },
  {
    id: "gitea",
    displayName: "Gitea",
    changeRequestAbbrev: "PR",
    changeRequestNoun: "pull request",
    changeRequestNumberPrefix: "#",
    issueNumberPrefix: "#",
    iconKind: "gitea",
    signIn: { cli: "tea", command: "tea login add" },
    cloudHosts: ["gitea.com"],
  },
  {
    id: "forgejo",
    displayName: "Forgejo",
    changeRequestAbbrev: "PR",
    changeRequestNoun: "pull request",
    changeRequestNumberPrefix: "#",
    issueNumberPrefix: "#",
    iconKind: "forgejo",
    signIn: { cli: "tea", command: "tea login add" },
  },
  {
    id: "codeberg",
    displayName: "Codeberg",
    changeRequestAbbrev: "PR",
    changeRequestNoun: "pull request",
    changeRequestNumberPrefix: "#",
    issueNumberPrefix: "#",
    iconKind: "codeberg",
    signIn: { cli: "tea", command: "tea login add" },
    cloudHosts: ["codeberg.org"],
  },
];

export const FORGE_DEFINITIONS = applyForgeManifestOverlays(DEFAULT_FORGE_DEFINITIONS, [
  SELF_HOSTED_FORGE_MANIFEST_OVERLAY,
]);

/** Forge definitions only present in dev builds (none today; mirrors providers). */
export const DEV_FORGE_DEFINITIONS: ForgeDefinition[] = [];

export const FORGE_IDS: string[] = FORGE_DEFINITIONS.map((definition) => definition.id);

/** Hosts that can be matched directly without probing the forge CLI. */
export function getForgeKnownHosts(definition: ForgeDefinition): string[] {
  return [...(definition.cloudHosts ?? []), ...(definition.selfHostedHosts ?? [])];
}

export function getForgeDefinition(
  id: string,
  definitions: ForgeDefinition[] = [...FORGE_DEFINITIONS, ...DEV_FORGE_DEFINITIONS],
): ForgeDefinition | null {
  return definitions.find((definition) => definition.id === id) ?? null;
}

/**
 * Resolve a forge definition, synthesizing a neutral one for a forge id the
 * client has never heard of (e.g. a self-hosted forge a newer daemon reports to
 * an older client). The neutral shape renders generic, never GitHub-branded.
 */
export function getForgeDefinitionOrNeutral(id: string): ForgeDefinition {
  return (
    getForgeDefinition(id) ?? {
      id,
      displayName: id,
      changeRequestAbbrev: "PR",
      changeRequestNoun: "pull request",
      changeRequestNumberPrefix: "#",
      issueNumberPrefix: "#",
      iconKind: "git",
      signIn: null,
    }
  );
}
