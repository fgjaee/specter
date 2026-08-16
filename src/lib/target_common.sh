# shellcheck shell=sh
# Shared routines for target.sh and target_merge.sh
# Source after common.sh and constants.sh

# Ensure blacklist exists
_ensure_blacklist() {
  BLACKLIST="$SPECTER_DIR/blacklist.txt"
  if [ ! -f "$BLACKLIST" ]; then
    log_i "TARGET" "Creating default blacklist"
    ensure_dir "$SPECTER_DIR"
    : > "$BLACKLIST"
    log_i "TARGET" "Default blacklist created"
  fi
  unset _pkg
}

# Parse customize.txt, sets $_customize_mode
_parse_customize() {
  _customize="/sdcard/Specter/customize.txt"
  _customize_mode=""
  if [ -f "$_customize" ]; then
    _first=$(head -1 "$_customize" 2>/dev/null || echo "")
    case "$_first" in
      "!") _customize_mode="force_all" ;;
      "?") _customize_mode="condition_all" ;;
      "#disable") _customize_mode="disabled" ;;
      *) _customize_mode="selective" ;;
    esac
    log_d "TARGET" "customize.txt mode: $_customize_mode"
  fi
  unset _customize _first
}

# Read TEE status, sets $teeBroken. Always return success: target.sh runs with
# set -e and an absent status cache must not abort an otherwise valid merge.
_read_tee_status() {
  teeBroken="false"
  if [ -f "$TEE_STATUS" ]; then
    teeBroken=$(grep -E '^(teeBroken|tee_broken)=' "$TEE_STATUS" 2>/dev/null | cut -d= -f2 || echo "false")
  fi
  return 0
}

# Merge helpers — used by --merge and --merge-denylist in target.sh

_merge_setup() {
  _count=0; _added=0
  _TMP_EXIST="$SPECTER_DIR/.target_exist.$$"
  _TMP_TARGET="$SPECTER_DIR/.target_new.$$"
}

_merge_cleanup() {
  [ -f "$_TMP_TARGET" ] && ksm_commit_targets "$_TMP_TARGET"
  unset _TMP_EXIST _TMP_TARGET
}

_merge_load_existing() {
  ksm_read_targets_raw > "$_TMP_TARGET" 2>/dev/null || : > "$_TMP_TARGET"
  ksm_read_targets > "$_TMP_EXIST" 2>/dev/null || : > "$_TMP_EXIST"
}

_normalize_pkg() {
  _np_line="$1"
  case "$_np_line" in *!) _np_line=${_np_line%!} ;; *\?) _np_line=${_np_line%\?} ;; esac
  printf '%s' "$_np_line"
  unset _np_line
}

_append_missing() {
  _am_line="$1"
  _am_base=$(_normalize_pkg "$_am_line")
  [ -z "$_am_base" ] && { unset _am_line _am_base; return 0; }
  if ! grep -Fxq "$_am_base" "$_TMP_EXIST" 2>/dev/null; then
    if [ "$KSM" = "cleveres" ]; then
      printf '%s\n' "$_am_base" >> "$_TMP_TARGET"
    else
      printf '%s\n' "$_am_line" >> "$_TMP_TARGET"
    fi
    printf '%s\n' "$_am_base" >> "$_TMP_EXIST"
    _added=$((_added + 1))
  fi
  _count=$((_count + 1))
  unset _am_line _am_base
}

# Compute suffix for a given package based on customize.txt and TEE status
# Sets $_suffix and $_custom_matched. CleveresTricky's current target parser
# is package-scope only; do not emit Tricky Store's !/? policy suffixes there.
_compute_suffix() {
  _pkg="$1"
  _suffix="" _custom_matched=false
  [ "$KSM" = "cleveres" ] && return 0
  if [ "$_customize_mode" = "selective" ]; then
    _match=$(grep -E "^${_pkg}[!?]?$" "$_customize" 2>/dev/null | head -1)
    if [ -n "$_match" ]; then
      _custom_matched=true
      case "$_match" in
        *!) _suffix="!" ;;
        *\?)
          if [ "$teeBroken" = "true" ]; then
            _suffix=""
          else
            _suffix="?"
          fi
          ;;
        *) _suffix="" ;;
      esac
    fi
  fi
  if [ "$_customize_mode" = "force_all" ]; then
    _suffix="!"
  elif [ "$_customize_mode" = "condition_all" ]; then
    _suffix="?"
  fi
}
