#!/system/bin/sh
set -e
MODDIR=${0%/*}
. "$MODDIR/../lib/common.sh"
. "$MODDIR/../lib/constants.sh"

detect_keystore_manager

BLACKLIST="$SPECTER_DIR/blacklist.txt"
BLACKLIST_ENABLED="$SPECTER_DIR/blacklist_enabled"
KNOWN_PKGS="$SPECTER_DIR/auto_known_packages.txt"
TEMP_LIST="$SPECTER_DIR/auto_scan_tmp.txt"

_CLEVERES_RCS_SAFE=0
if [ "$KSM" = "cleveres" ] && { [ -f "$SPECTER_DIR/rcs_safe_mode" ] || [ -f "$SPECTER_DIR/backup/cleveres_rcs/active" ]; }; then
  _CLEVERES_RCS_SAFE=1
fi

_is_rcs_protected() {
  [ "$_CLEVERES_RCS_SAFE" = "1" ] || return 1
  _arp_pkg="$1"
  for _arp_protected in $CLEVERES_RCS_PROTECTED_TARGETS; do
    if [ "$_arp_pkg" = "$_arp_protected" ]; then
      unset _arp_pkg _arp_protected
      return 0
    fi
  done
  unset _arp_pkg _arp_protected
  return 1
}

_feature_should_run "target" || { log_d "AUTO_TARGET" "target disabled or claimed, skipping"; exit 0; }

log_i "AUTO_TARGET" "Scanning for new packages"

ksm_available || { log_d "AUTO_TARGET" "no keystore manager, skipping"; exit 0; }
ksm_target_management_available || { log_i "AUTO_TARGET" "CleveresTricky Global Mode is active; target.txt is inactive, skipping"; exit 0; }
[ -f "$KSM_TARGETS" ] || { log_w "AUTO_TARGET" "target list missing, skipping"; exit 0; }

pkgs=$(pm list packages -3 2>/dev/null) || { log_e "AUTO_TARGET" "pm list packages failed"; exit 1; }
echo "$pkgs" | cut -d ":" -f 2 | sort -u > "$TEMP_LIST"
[ ! -s "$TEMP_LIST" ] && { rm -f "$TEMP_LIST"; exit 0; }

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

# Keep the proven RCS-safe Cleveres core present and proactively remove the two
# packages that must remain on the genuine Android Keystore path.
if [ "$_CLEVERES_RCS_SAFE" = "1" ]; then
  _SAFE_STAGING="$SPECTER_DIR/.auto_target_safe.$$"
  : > "$_SAFE_STAGING"
  while IFS= read -r _line || [ -n "$_line" ]; do
    [ -z "$_line" ] && continue
    _base="$_line"
    case "$_base" in *\!) _base=${_base%!} ;; *\?) _base=${_base%\?} ;; esac
    _is_rcs_protected "$_base" && { log_i "AUTO_TARGET" "RCS Safe Mode: removing $_base"; continue; }
    printf '%s\n' "$_line" >> "$_SAFE_STAGING"
  done < "$_STAGING"
  mv "$_SAFE_STAGING" "$_STAGING"

  for _safe_pkg in $CLEVERES_RCS_SAFE_TARGETS; do
    if ! sed 's/[!?]$//' "$_STAGING" 2>/dev/null | grep -Fxq "$_safe_pkg"; then
      printf '%s\n' "$_safe_pkg" >> "$_STAGING"
      log_i "AUTO_TARGET" "RCS Safe Mode: restored required target $_safe_pkg"
    fi
  done
  unset _SAFE_STAGING _safe_pkg
fi

if [ -n "$_new_pkgs" ]; then
  _default_mode=$(cfg_get target_default_mode "bare")
  case "$_default_mode" in
    "force") _suffix="!" ;;
    "conditional") _suffix="?" ;;
    *) _suffix="" ;;
  esac
  [ "$KSM" = "cleveres" ] && _suffix=""
  _added=0
  while IFS= read -r _pkg; do
    [ -z "$_pkg" ] && continue
    _is_rcs_protected "$_pkg" && continue
    echo "${_pkg}${_suffix}" >> "$_STAGING"
    _added=$((_added + 1))
  done <<EOF
$_new_pkgs
EOF
  unset _default_mode _suffix
  log_i "AUTO_TARGET" "Added $_added new package(s)"
fi

# Cleanup: remove entries for uninstalled or blacklisted packages
_installed_list=$(pm list packages -3 2>/dev/null | cut -d: -f2 | sort -u)
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
    continue
  fi

  # Skip duplicate bases (overlapping scans can re-append the same pkgs).
  if grep -Fxq "$_base" "$_SEEN" 2>/dev/null; then
    _cleaned=$((_cleaned + 1))
    continue
  fi
  echo "$_base" >> "$_SEEN"

  _keep=false
  if [ "$_CLEVERES_RCS_SAFE" = "1" ]; then
    for _fixed in $CLEVERES_RCS_SAFE_TARGETS; do
      [ "$_base" = "$_fixed" ] && { _keep=true; break; }
    done
  else
    for _fixed in $FIXED_TARGETS; do
      [ "$_base" = "$_fixed" ] && { _keep=true; break; }
    done
  fi
  if [ "$_keep" = "true" ]; then echo "$_line" >> "$_TMP_CLEAN"; continue; fi

  if echo "$_installed_list" | grep -Fxq "$_base" 2>/dev/null; then
    if [ -n "$_bl_set" ] && echo "$_bl_set" | grep -Fxq "$_base" 2>/dev/null; then
      _cleaned=$((_cleaned + 1))
      continue
    fi
    echo "$_line" >> "$_TMP_CLEAN"
  else
    _cleaned=$((_cleaned + 1))
  fi
done < "$_STAGING"

ksm_commit_targets "$_TMP_CLEAN"
[ "$_cleaned" -gt 0 ] && log_i "AUTO_TARGET" "Removed $_cleaned stale/blacklisted/RCS-protected entry(s)"

unset _installed_list _bl_set _cleaned _fixed _keep _base

cp "$TEMP_LIST" "$KNOWN_PKGS" 2>/dev/null || true
rm -f "$TEMP_LIST" "$_EXISTING" "$_STAGING" "$_SEEN"
log_i "AUTO_TARGET" "Auto-target scan complete"
exit 0
