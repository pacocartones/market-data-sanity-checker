#!/usr/bin/env bash
# Commit policy for pull requests (new commits only: BASE..HEAD, never the history before).
#  1. No AI attribution trailers or footers in commit messages.
#  2. Commits written under a maintainer identity must use a GitHub noreply address
#     (contributors may use any address; bots are exempt).
# Usage: scripts/check-commit-policy.sh <base-sha> <head-sha>
set -euo pipefail

base="${1:?base sha}"
head="${2:?head sha}"

ai_pattern='co-authored-by:[[:space:]]*(claude|gpt|chatgpt|copilot|codebuff|gemini|cursor|aider|devin|anthropic|openai|agent:)|generated (with|by) (claude|chatgpt|copilot|codex|gemini|an? ai)|🤖'
maintainer_names='^(pacocartones|paco cartones|maintainer|agent:.*)$'

fail=0
while IFS= read -r sha; do
  msg="$(git log -1 --format=%B "$sha")"
  if printf '%s\n' "$msg" | grep -Eiq "$ai_pattern"; then
    echo "::error title=AI attribution in commit::${sha:0:10} carries an AI trailer or footer; remove it (git rebase -i, reword)."
    fail=1
  fi
  for pair in "$(git log -1 --format='%an|%ae' "$sha")" "$(git log -1 --format='%cn|%ce' "$sha")"; do
    name="${pair%%|*}"; email="${pair#*|}"
    lower="$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')"
    if printf '%s' "$lower" | grep -Eq "$maintainer_names"; then
      case "$email" in
        *@users.noreply.github.com) ;;
        *) echo "::error title=Personal address on a maintainer commit::${sha:0:10} is written under a maintainer identity with a non-noreply address; set user.email to the GitHub noreply address."; fail=1 ;;
      esac
    fi
  done
done < <(git rev-list --no-merges "${base}..${head}")

[ "$fail" -eq 0 ] && echo "commit policy: ok"
exit "$fail"
