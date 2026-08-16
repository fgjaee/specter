#!/system/bin/sh
set -e
MODDIR=${0%/*}
. "$MODDIR/../lib/common.sh"
. "$MODDIR/../lib/constants.sh"
. "$MODDIR/../lib/target_common.sh"

log_d "TARGET" "Starting target management"
detect_keystore_manager
ksm_available || die "No supported keystore manager data directory found"

_CLEVERES_RCS_SAFE=0
if [ "$KSM" = "cleveres" ] && { [ -f "$SPECTER_DIR/rcs_safe_mode" ] || [ -f "$SPECTER_DIR/backup/cleveres_rcs/active" ]; }; then
  _CLEVERES_RCS_SAFE=1
fi
_EFFECTIVE_FIXED_TARGETS="$FIXED_TARGETS"
[ "$_CLEVERES_RCS_SAFE" = "1" ] && _EFFECTIVE_FIXED_TARGETS="$CLEVERES_RCS_SAFE_TARGETS"

_is_rcs_protected() {
  [ "$_CLEVERES_RCS_SAFE" = "1" ] || return 1
  _irp_pkg="$1"
  for _irp_protected in $CLEVERES_RCS_PROTECTED_TARGETS; do
    if [ "$_irp_pkg" = "$_irp_protected" ]; then
      unset _irp_pkg _irp_protected
      return 0
    fi
  done
  unset _irp_pkg _irp_protected
  return 1
}

_prune_rcs_protected_file() {
  [ "$_CLEVERES_RCS_SAFE" = "1" ] || return 0
  _prpf_file="$1"
  [ -f "$_prpf_file" ] || { unset _prpf_file; return 0; }
  _prpf_tmp="${_prpf_file}.rcs.$$"
  : > "$_prpf_tmp"
  while IFS= read -r _prpf_line || [ -n "$_prpf_line" ]; do
    _prpf_base="$(_normalize_pkg "$_prpf_line")"
    if _is_rcs_protected "$_prpf_base"; then
      log_i "TARGET" "RCS Safe Mode: excluding $_prpf_base"
      continue
    fi
    printf '%s\n' "$_prpf_line" >> "$_prpf_tmp"
  done < "$_prpf_file"
  mv "$_prpf_tmp" "$_prpf_file"
  unset _prpf_file _prpf_tmp _prpf_line _prpf_base
}

# CleveresTricky deliberately ignores target.txt while global_mode exists.
# Keep read-only listing available for diagnostics, but never claim a write is active.
if ! ksm_target_management_available; then
  case "${1:-}" in
    --list|--list-raw) ;;
    *) die "CleveresTricky Global Mode is enabled; target.txt is inactive. Disable Global Mode in CleveresTricky before using Specter target management." ;;
  esac
fi

case "${1:-}" in
  --list)
    ksm_read_targets
    exit 0
    ;;
  --list-raw)
    # Preserve !/? for the WebUI; drop [section] headers (not packages).
    ksm_read_targets_raw | grep -v '^[[:space:]]*\[' || true
    exit 0
    ;;
  --set)
    [ -n "${2:-}" ] && [ -f "$2" ] || die "target.sh --set requires an existing file argument"
    # Apply/WebUI rebuilds from pm -3 only; re-add fixed targets missing by base name.
    # In the proven Cleveres RCS-safe profile, Google Messages + Google IMS are
    # never allowed back into target.txt and the safe core replaces FIXED_TARGETS.
    _prune_rcs_protected_file "$2"
    _set_bases="$SPECTER_DIR/.target_set_bases.$$"
    : > "$_set_bases"
    while IFS= read -r _set_line || [ -n "$_set_line" ]; do
      [ -z "$_set_line" ] && continue
      case "$_set_line" in \[*\]) continue ;; esac
      _set_base="$(_normalize_pkg "$_set_line")"
      _is_rcs_protected "$_set_base" && continue
      printf '%s\n' "$_set_base" >> "$_set_bases"
    done < "$2"
    for _set_entry in $_EFFECTIVE_FIXED_TARGETS; do
      grep -Fxq "$_set_entry" "$_set_bases" 2>/dev/null && continue
      printf '%s\n' "$_set_entry" >> "$2"
    done
    rm -f "$_set_bases"
    unset _set_bases _set_line _set_base _set_entry
    ksm_commit_targets "$2"
    log_i "TARGET" "Committed target list from $2"
    exit 0
    ;;
esac

MODULE_ROOT="${MODDIR%/features}"
TEMP_PKGS="$MODULE_ROOT/pkgs.txt"
_TMP_TARGET="$SPECTER_DIR/.target_new.$$"

_read_tee_status
_ensure_blacklist
_parse_customize

_ensure_target_txt() {
  [ -n "$(ksm_read_targets)" ] && return 0
  log_w "TARGET" "target list missing or empty, creating default"
  _et_tmp="$SPECTER_DIR/.target_seed.$$"
  for _entry in $_EFFECTIVE_FIXED_TARGETS; do
    echo "$_entry"
  done > "$_et_tmp"
  ksm_commit_targets "$_et_tmp"
  unset _entry _et_tmp
}

_ensure_target_txt

case "${1}" in
  --merge-denylist)
    log_i "TARGET" "Mode: merge-denylist"
    command -v magisk >/dev/null 2>&1 || { log_w "TARGET" "magisk not found, skipping"; exit 0; }
    _merge_setup
    trap 'rm -f "$_TMP_TARGET" "$_TMP_EXIST"' EXIT
    _merge_load_existing
    _prune_rcs_protected_file "$_TMP_TARGET"
    _prune_rcs_protected_file "$_TMP_EXIST"

    _denylist=$(magisk --denylist ls 2>/dev/null | awk -F'|' '{print $1}' | grep -v "isolated" || true)
    if [ -n "$_denylist" ]; then
      for _pkg in $_denylist; do
        [ -z "$_pkg" ] && continue
        _is_rcs_protected "$_pkg" && continue
        _compute_suffix "$_pkg"
        _append_missing "${_pkg}${_suffix}"
      done
      unset _pkg
    fi

    for _entry in $_EFFECTIVE_FIXED_TARGETS; do
      _append_missing "$_entry"
    done

    _merge_cleanup
    : "${_added:=0}"
    log_i "TARGET" "Denylist merge: checked $_count entries, added $_added"
    unset _count _added _entry
    ;;
  --merge)
    log_i "TARGET" "Mode: merge"
    _merge_setup
    trap 'rm -f "$TEMP_PKGS" "${TEMP_PKGS}.filtered" "$_TMP_TARGET" "$_TMP_EXIST"' EXIT
    _merge_load_existing
    _prune_rcs_protected_file "$_TMP_TARGET"
    _prune_rcs_protected_file "$_TMP_EXIST"

    for entry in $_EFFECTIVE_FIXED_TARGETS; do
      _append_missing "$entry"
    done

    pkgs=$(pm list packages -3 2>/dev/null) || {
      log_w "TARGET" "Failed to list packages"
    }
    if [ -n "$pkgs" ]; then
      echo "$pkgs" | cut -d ":" -f 2 > "$TEMP_PKGS"
      if [ -f "$SPECTER_DIR/blacklist_enabled" ] && [ -s "$BLACKLIST" ]; then
        if grep -Fvxf "$BLACKLIST" "$TEMP_PKGS" > "${TEMP_PKGS}.filtered" 2>/dev/null; then
          mv "${TEMP_PKGS}.filtered" "$TEMP_PKGS"
        else
          log_w "TARGET" "Blacklist filtering failed"
        fi
      fi

      while read -r pkg; do
        [ -z "$pkg" ] && continue
        _is_rcs_protected "$pkg" && continue
        _compute_suffix "$pkg"
        _append_missing "${pkg}${_suffix}"
      done < "$TEMP_PKGS"
      rm -f "$TEMP_PKGS" "${TEMP_PKGS}.filtered"
    fi

    _merge_cleanup
    : "${_added:=0}"
    log_i "TARGET" "Checked $_count entries, added $_added"
    unset _count _added
    ;;
  *)
    log_i "TARGET" "Mode: overwrite"
    _count=0
    trap 'rm -f "$TEMP_PKGS" "${TEMP_PKGS}.filtered" "$_TMP_TARGET"' EXIT

    for entry in $_EFFECTIVE_FIXED_TARGETS; do
      echo "$entry" >> "$_TMP_TARGET"
      _count=$((_count + 1))
    done

    pkgs=$(pm list packages -3 2>/dev/null) || {
      log_w "TARGET" "Failed to list packages"
    }
    if [ -n "$pkgs" ]; then
      echo "$pkgs" | cut -d ":" -f 2 > "$TEMP_PKGS"
      if [ -f "$SPECTER_DIR/blacklist_enabled" ] && [ -s "$BLACKLIST" ]; then
        if grep -Fvxf "$BLACKLIST" "$TEMP_PKGS" > "${TEMP_PKGS}.filtered" 2>/dev/null; then
          mv "${TEMP_PKGS}.filtered" "$TEMP_PKGS"
        else
          log_w "TARGET" "Blacklist filtering failed"
        fi
      fi

      while read -r pkg; do
        [ -z "$pkg" ] && continue
        _is_rcs_protected "$pkg" && continue
        _suffix=""
        _compute_suffix "$pkg"
        echo "${pkg}${_suffix}" >> "$_TMP_TARGET"
        _count=$((_count + 1))
      done < "$TEMP_PKGS"
      rm -f "$TEMP_PKGS" "${TEMP_PKGS}.filtered"
    fi

    sort -u "$_TMP_TARGET" -o "$_TMP_TARGET"

    ksm_commit_targets "$_TMP_TARGET"

    _count=$(ksm_read_targets | wc -l)
    log_i "TARGET" "Wrote $_count entries to target list"
    ;;
esac

log_i "TARGET" "Target management complete"
exit 0
