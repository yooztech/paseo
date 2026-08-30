#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
app_dir="$repo_root/packages/app"
version="$(cd "$app_dir" && node -p "require('./package.json').version")"
prefix="app-v${version}-fork."
release_tag=""
matching_tags=()

while IFS= read -r tag; do
  [[ "$tag" == "$prefix"* ]] || continue
  fork_number="${tag#"$prefix"}"
  [[ "$fork_number" =~ ^[1-9][0-9]{0,2}$ ]] || continue
  matching_tags+=("$tag")
done < <(git -C "$repo_root" tag --points-at HEAD)

if [[ "${#matching_tags[@]}" -ne 1 ]]; then
  printf 'Expected exactly one app-v%s-fork.N tag on HEAD; found: %s\n' \
    "$version" "${matching_tags[*]:-none}" >&2
  exit 1
fi

release_tag="${matching_tags[0]}"
ipa_path="$app_dir/dist/${release_tag}.ipa"
mkdir -p "$(dirname "$ipa_path")"
rm -f "$ipa_path"

cd "$app_dir"
PASEO_RELEASE_TAG="$release_tag" npx eas build --platform ios --profile production --local --output "$ipa_path"

if [[ ! -f "$ipa_path" ]]; then
  printf 'Local iOS build completed without producing %s\n' "$ipa_path" >&2
  exit 1
fi

submit_attempts=3
submit_retry_delay_seconds=15

for ((submit_attempt = 1; submit_attempt <= submit_attempts; submit_attempt++)); do
  if npx eas submit --platform ios --profile production --path "$ipa_path"; then
    printf 'Submitted %s from %s\n' "$release_tag" "$ipa_path"
    exit 0
  fi

  if [[ "$submit_attempt" -eq "$submit_attempts" ]]; then
    printf 'Failed to submit %s after %d attempts\n' "$release_tag" "$submit_attempts" >&2
    exit 1
  fi

  retry_delay=$((submit_retry_delay_seconds * (1 << (submit_attempt - 1))))
  printf 'Submit attempt %d/%d failed; retrying in %d seconds\n' \
    "$submit_attempt" "$submit_attempts" "$retry_delay" >&2
  sleep "$retry_delay"
done
