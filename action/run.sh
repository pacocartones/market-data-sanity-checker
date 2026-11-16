#!/usr/bin/env bash
# Runs `mdsc check` for the GitHub Action in ../action.yml.
# Inputs arrive as MDSC_* environment variables (never interpolated into the script).
# Writes the step outputs and a short job summary, then exits with mdsc's exit code.
# MDSC_CLI overrides the command (used by the repository's own tests).
set -uo pipefail

# Render untrusted diagnostics as one JSON string. Also escape hashes: the
# runner's legacy ##[command] syntax is recognized anywhere, even inside JSON.
# JSON decoding still recovers the complete diagnostic without loss.
encode_log_data() { jq -Rrs 'tojson | gsub("#"; "\\u0023")'; }

die() {
  local message
  message=$(printf '%s' "$1" | encode_log_data)
  message=${message//'%'/'%25'}
  printf '::error title=market-data-sanity-checker::%s\n' "$message"
  exit 2
}

file=${MDSC_FILE:-}
[ -n "$file" ] || die "the 'file' input is required"
[ -f "$file" ] || die "file not found: $file"

# Default: the exact package version released with this ref of the action, so a
# tag always runs the same code. A major or major.minor in 'version' opts into updates.
version=${MDSC_VERSION:-}
if [ -z "$version" ]; then
  version=$(jq -r '.version // empty' "$(dirname "$0")/../package.json" 2>/dev/null)
  [ -n "$version" ] || die "could not read the package version from the action's package.json"
fi
[[ $version =~ ^[0-9]+(\.[0-9]+){0,2}$ ]] || die "'version' must be a major, major.minor or exact version, got: $version"

args=(check --file "$file" --format json)
case ${MDSC_FAIL_ON:-} in
  '') ;; # mdsc's default gate: fail on critical findings
  critical | warning | info) args+=(--fail-on "$MDSC_FAIL_ON") ;;
  *) die "'fail-on' must be critical, warning or info, got: $MDSC_FAIL_ON" ;;
esac
if [ -n "${MDSC_MIN_SCORE:-}" ]; then
  [[ $MDSC_MIN_SCORE =~ ^[0-9]+$ ]] && [ "$MDSC_MIN_SCORE" -le 100 ] || die "'min-score' must be an integer from 0 to 100, got: $MDSC_MIN_SCORE"
  args+=(--min-score "$MDSC_MIN_SCORE")
fi
[ -z "${MDSC_SYMBOL:-}" ] || args+=(--symbol "$MDSC_SYMBOL")
[ -z "${MDSC_SOURCE:-}" ] || args+=(--source "$MDSC_SOURCE")
[ -z "${MDSC_HTML:-}" ] || args+=(--html "$MDSC_HTML")

tmp="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
echo "mdsc: market-data-sanity-checker@$version"
if [ -n "${MDSC_CLI:-}" ]; then
  read -r -a cli <<<"$MDSC_CLI"
else
  # Install into a private prefix rather than npx: run from a checkout of this
  # repository (or any package with the same name), npx would resolve the local
  # package instead of the published one.
  prefix="$tmp/mdsc-$version"
  npm install --prefix "$prefix" --no-save --no-audit --no-fund --loglevel=error \
    "market-data-sanity-checker@$version" >&2 || die "npm install market-data-sanity-checker@$version failed"
  cli=(node "$prefix/node_modules/market-data-sanity-checker/dist/cli.js")
fi

report="$tmp/mdsc-report.json"
diagnostics="$tmp/mdsc-diagnostics.log"
"${cli[@]}" "${args[@]}" >"$report" 2>"$diagnostics"
code=$?

if [ -s "$diagnostics" ]; then
  printf 'mdsc: CLI diagnostics: %s\n' "$(encode_log_data <"$diagnostics")" >&2
fi
rm -f "$diagnostics"

if ! jq -e '.sanity_score' "$report" >/dev/null 2>&1; then
  echo "::error title=market-data-sanity-checker::mdsc produced no report (exit $code)"
  exit $(( code == 0 ? 2 : code ))
fi

score=$(jq -r '.sanity_score' "$report")
critical=$(jq -r '.summary.critical' "$report")
warning=$(jq -r '.summary.warning' "$report")
info=$(jq -r '.summary.info' "$report")

out=${GITHUB_OUTPUT:-/dev/null}
{
  echo "score=$score"
  echo "critical=$critical"
  echo "warning=$warning"
  echo "info=$info"
  echo "report=$report"
} >>"$out"

verdict="passed"
[ "$code" -eq 0 ] || verdict="failed"
summary=${GITHUB_STEP_SUMMARY:-/dev/null}
{
  echo "### market-data-sanity-checker: $verdict"
  echo
  echo "| File | Symbol | Score | Critical | Warning | Info |"
  echo "| --- | --- | --- | --- | --- | --- |"
  # GFM renders backslash-escaped ASCII punctuation literally. Escape it all so
  # untrusted values cannot create Markdown constructs after line breaks collapse.
  jq -r --arg f "$file" '
    def markdown_cell:
      gsub("[\\r\\n]+"; " ")
      | explode
      | map(
          if ((. >= 33 and . <= 47) or
              (. >= 58 and . <= 64) or
              (. >= 91 and . <= 96) or
              (. >= 123 and . <= 126))
          then [92, .]
          else [.]
          end
        )
      | flatten
      | implode;
    "| \($f | markdown_cell) | \((.symbol // "") | markdown_cell) | \(.sanity_score) | \(.summary.critical) | \(.summary.warning) | \(.summary.info) |"
  ' "$report"
  echo
  echo "Full report: \`$report\` (JSON)."
} >>"$summary"

echo "mdsc: score $score, $critical critical, $warning warning, $info info ($verdict)"
exit "$code"
