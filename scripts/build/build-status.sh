# shellcheck shell=bash
# Shared by the standalone asset builder and the managed server launcher.
build_status() {
  local file=${WILD_WHEELS_BUILD_STATUS_FILE:-}
  [[ -n $file ]] || return 0
  local tmp="$file.tmp.$$"
  printf '{"state":"%s","at":%s}\n' "$1" "$(date +%s)" > "$tmp"
  mv -f -- "$tmp" "$file"
}

# Cargo also checks already-built targets. Only announce compilation when
# Cargo reports a compiler invocation; distinguish contention on its cache.
run_cargo_build() {
  local component=$1 line next state='' mark=$SECONDS started=$SECONDS
  shift
  "$@" 2>&1 | {
    while IFS= read -r line; do
      printf '%s\n' "$line"
      case "$line" in
        *"Blocking waiting for file lock"*) next="waiting-$component" ;;
        *"Compiling "*) next="compiling-$component" ;;
        *) continue ;;
      esac
      if [[ $next != "$state" ]]; then
        if [[ -n $state ]]; then printf '%s took %ss.\n' "$state" "$((SECONDS-mark))"; fi
        build_status "$next"
        state=$next
        mark=$SECONDS
      fi
    done
    if [[ -n $state ]]; then printf '%s took %ss.\n' "$state" "$((SECONDS-mark))"; fi
  }
  printf 'Cargo %s check/build took %ss (including lock waits).\n' "$component" "$((SECONDS-started))"
}
