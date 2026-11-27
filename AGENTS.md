# Fork agent instructions

Read `CLAUDE.md` before working in this repository. Its upstream engineering guidance applies except where this file overrides it. Upstream Markdown describes upstream Paseo, not fork-specific behavior; check the fork's code, tests, and history for fork facts.

## Patch-only branch policy

On `downstream/patch-build`, make upgrade and repair changes only in `.patch` files under `scripts/fork/upstream/`. Do not add, update, or remove upstream Markdown snapshots, source files, tests, configuration, or other non-patch files in this branch. This applies to files written by scripts as well as manual edits.

Before running an updater, check which paths it writes. If it would write any non-patch file, including upstream documentation or version metadata, stop before running it and report the paths. Do not create a separate branch or Git worktree for patch preparation.

Change this `AGENTS.md` only when the user explicitly requests a change to the branch policy.

## Upstream upgrade and repair gate

Before upgrading upstream or repairing any failure discovered during an upgrade, read and apply this section. Conversation summaries and long-term memory do not replace this repository rule.

Before changing source, tests, configuration, or dependencies to address an upgrade failure, complete these steps **in order**:

1. **Establish provenance.** Compare the affected files and relevant history between the fork and the explicitly selected official upstream tag or commit. Classify the failure as upstream-existing, fork-introduced, merge-introduced, or unresolved. A CI failure alone does not establish its origin. If provenance is unresolved, continue investigating; do not implement a speculative repair.
2. **Search official fixes.** Inspect upstream follow-up commits and pull requests for the same failure, including fixes outside the selected release's ancestry. Checking only the release tag is insufficient. Do not write a fork fix first and search upstream afterward.
3. **Show the evidence before editing.** State the classification, compared refs and paths, relevant upstream commit or PR if found, and the chosen repair. This is a required pre-edit checkpoint, not a retrospective explanation.
4. **Prefer the official implementation.** When an applicable official fix exists, adopt it with its required dependencies and behavioral coverage rather than independently recreating it or adding extra fork behavior. Preserve fork features that the official implementation does not supersede. If the official fix cannot be applied as written, identify the concrete incompatibility before adapting it.
5. **Use a fork repair only when justified.** If no applicable official fix is found, state what was searched and why a fork-specific change is necessary before implementing it. Do not delete tests, restore removed configuration, add retries, or change timeouts merely to make CI green without establishing the intended behavior and provenance.

Skipping this gate is a workflow violation even if the resulting patch passes tests. A promise to follow it next time, a memory entry, or a post-edit provenance check does not satisfy it.
