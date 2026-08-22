#!/system/bin/sh
set -e
MODDIR=${0%/*}
. "$MODDIR/../lib/common.sh"
. "$MODDIR/../lib/constants.sh"

detect_keystore_manager

BLACKLIST="$SPECTER_DIR/blacklist.txt"
BLACKLIST_ENABLED="$SPECTER_DIR/blacklist_enabled"
KNOWN_PKGS="$SPECTER_DIR/auto_known_packages.txt"
TEMP_LIST="$SPECTER_DIR/.auto_target_scan.$$"
trap 'rm -f "$TEMP_LIST" "$SPECTER_DIR/.auto_target_existing.$$" "$SPECTER_DIR/.auto_target_staging.$$" "$SPECTER_DIR/.auto_target_adds.$$" "$SPECTER_DIR/.auto_target_clean.$$" "$SPECTER_DIR/.auto_target_seen.$$"' EXIT

_feature_should_run "target" || { log_d "AUTO_TARGET" "target disabled or claimed, skipping"; exit 0; }

log_i "AUTO_TARGET" "Scanning for new packages"

ksm_available || { log_d "AUTO_TARGET" "no keystore manager, skipping"; exit 0; }
ksm_target_management_available || { log_i "AUTO_TARGET" "CleveresTricky Global Mode active; targeted app list is inactive, skipping"; exit 0; }
[ -f "$KSM_TARGETS" ] || { log_w "AUTO_TARGET" "target list missing, skipping"; exit 0; }

_CLEVERES_RCS_SAFE=0
if [ "$KSM" = "cleveres" ] && { [ -f "$SPECTER_DIR/rcs_safe_mode" ] || [ -f "$SPECTER_DIR/backup/cleveres_rcs/active" ]; }; then
  _CLEVERES_RCS_SAFE=1
fi

_is_rcs_protected() {
  [ "$_CLEVERES_RCS_SAFE" = "1" ] || return 1
  case " $CLEVERES_RCS_PROTECTED_TARGETS " in
    *" $1 "*) return 0 ;;
  esac
  return 1
}

pkgs=$(pm list packages -3 2>/dev/null) || { log_e "AUTO_TARGET" "pm list packages failed"; exit 1; }
echo "$pkgs" | cut -d ":" -f 2 | sort -u > "$TEMP_LIST"
[ ! -s "$TEMP_LIST" ] && { rm -f "$TEMP_LIST"; exit 0; }

ksm_lock_targets || { log_e "AUTO_TARGET" "failed to lock target list"; exit 1; }

_EXISTING="$SPECTER_DIR/.auto_target_existing.$$"
ksm_read_targets > "$_EXISTING" 2>/dev/null || : > "$_EXISTING"

_known=""
[ -f "$KNOWN_PKGS" ] && _known=$(cat "$KNOWN_PKGS")

_new_pkgs=""
while IFS= read -r _pkg; do
  [ -z "$_pkg" ] && continue
  _is_rcs_protected "$_pkg" && continue
  if ! echo "$_known" | grep -Fxq "$_pkg" 2>/dev/null && ! grep -Fxq "$_pkg" "$_EXISTING" 2>/dev/null; then
    if [ -f "$BLACKLIST_ENABLED" ] && [ -s "$BLACKLIST" ]; then
      if grep -Fxq "$_pkg" "$BLACKLIST" 2>/dev/null; then
        continue
      fi
    fi
    _new_pkgs="$_new_pkgs$_pkg
"
  fi
done < "$TEMP_LIST"

_STAGING="$SPECTER_DIR/.auto_target_staging.$$"
ksm_read_targets_raw > "$_STAGING" 2>/dev/null || : > "$_STAGING"
_ADDS="$SPECTER_DIR/.auto_target_adds.$$"
: > "$_ADDS"

if [ "$_CLEVERES_RCS_SAFE" = "1" ]; then
  for _required in $CLEVERES_RCS_SAFE_TARGETS; do
    grep -Fxq "$_required" "$_EXISTING" 2>/dev/null && continue
    printf '%s\n' "$_required" >> "$_ADDS"
  done
  unset _required
fi

if [ -n "$_new_pkgs" ]; then
  _suffix=""
  if [ "$KSM_PER_APP_MODES" = "1" ]; then
    _default_mode=$(cfg_get target_default_mode "bare")
    case "$_default_mode" in
      "force") _suffix="!" ;;
      "conditional") _suffix="?" ;;
      *) _suffix="" ;;
    esac
    unset _default_mode
  fi
  _added=0
  while IFS= read -r _pkg; do
    [ -z "$_pkg" ] && continue
    echo "${_pkg}${_suffix}" >> "$_ADDS"
    _added=$((_added + 1))
  done <<EOF
$_new_pkgs
EOF
  unset _suffix
  log_i "AUTO_TARGET" "Added $_added new package(s)"
fi

_bl_set=""
[ -f "$BLACKLIST_ENABLED" ] && [ -s "$BLACKLIST" ] && _bl_set=$(cat "$BLACKLIST")
_TMP_CLEAN="$SPECTER_DIR/.auto_target_clean.$$"
_SEEN="$SPECTER_DIR/.auto_target_seen.$$"
: > "$_TMP_CLEAN"
: > "$_SEEN"

_cleaned=0
while IFS= read -r _line || [ -n "$_line" ]; do
  [ -z "$_line" ] && continue
  case "$_line" in \[*\]) echo "$_line" >> "$_TMP_CLEAN"; continue ;; esac
  _base="$_line"
  case "$_base" in *\!) _base=${_base%!} ;; *\?) _base=${_base%\?} ;; esac
  if _is_rcs_protected "$_base"; then
    _cleaned=$((_cleaned + 1))
    log_i "AUTO_TARGET" "RCS Safe Mode: excluding $_base"
    continue
  fi
  # Skip duplicate bases (overlapping scans can re-append the same pkgs).
  if grep -Fxq "$_base" "$_SEEN" 2>/dev/null; then
    _cleaned=$((_cleaned + 1))
    continue
  fi
  echo "$_base" >> "$_SEEN"
  _keep=false
  for _fixed in $FIXED_TARGETS; do
    [ "$_base" = "$_fixed" ] && { _keep=true; break; }
  done
  if [ "$_keep" = "true" ]; then echo "$_line" >> "$_TMP_CLEAN"; continue; fi
  if grep -Fxq "$_base" "$TEMP_LIST" 2>/dev/null; then
    if [ -n "$_bl_set" ] && echo "$_bl_set" | grep -Fxq "$_base" 2>/dev/null; then
      _cleaned=$((_cleaned + 1))
      continue
    fi
    echo "$_line" >> "$_TMP_CLEAN"
  else
    _cleaned=$((_cleaned + 1))
  fi
done < "$_STAGING"

_txt_insert_default "$_TMP_CLEAN" "$_ADDS"
ksm_commit_targets "$_TMP_CLEAN"
[ "$_cleaned" -gt 0 ] && log_i "AUTO_TARGET" "Removed $_cleaned stale/blacklisted entry(s)"

unset _bl_set _cleaned _fixed _keep _base

cp "$TEMP_LIST" "$KNOWN_PKGS" 2>/dev/null || true
log_i "AUTO_TARGET" "Auto-target scan complete"
exit 0
