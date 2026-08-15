# shellcheck shell=sh
# Smart hot install for KernelSU-family managers.
#
# Updates are classified before the staged module replaces the live copy:
#   ui      - WebUI / installer metadata only. Swap files, do nothing else.
#   runtime - Shell/features/libs changed. Swap files and refresh Specter runtime.
#   reboot  - Boot/mount-sensitive files changed. Leave the update staged.

_hi_changed_paths() {
  _hi_cp_live="$1"
  _hi_cp_stage="$2"

  {
    (cd "$_hi_cp_live" 2>/dev/null && find . \( -type f -o -type l \) -print 2>/dev/null)
    (cd "$_hi_cp_stage" 2>/dev/null && find . \( -type f -o -type l \) -print 2>/dev/null)
  } | sed 's#^\./##' | sort -u | while IFS= read -r _hi_cp_rel; do
    [ -n "$_hi_cp_rel" ] || continue
    _hi_cp_old="$_hi_cp_live/$_hi_cp_rel"
    _hi_cp_new="$_hi_cp_stage/$_hi_cp_rel"

    if [ -L "$_hi_cp_old" ] || [ -L "$_hi_cp_new" ]; then
      if [ ! -L "$_hi_cp_old" ] || [ ! -L "$_hi_cp_new" ] \
        || [ "$(readlink "$_hi_cp_old" 2>/dev/null)" != "$(readlink "$_hi_cp_new" 2>/dev/null)" ]; then
        printf '%s\n' "$_hi_cp_rel"
      fi
    elif [ ! -f "$_hi_cp_old" ] || [ ! -f "$_hi_cp_new" ] || ! cmp -s "$_hi_cp_old" "$_hi_cp_new"; then
      printf '%s\n' "$_hi_cp_rel"
    fi
  done

  unset _hi_cp_live _hi_cp_stage _hi_cp_rel _hi_cp_old _hi_cp_new
}

_hi_classify_changes() {
  _hi_cc_changes="$1"
  _hi_cc_mode="ui"
  _hi_cc_old_ifs="$IFS"
  IFS='
'
  for _hi_cc_rel in $_hi_cc_changes; do
    [ -n "$_hi_cc_rel" ] || continue
    case "$_hi_cc_rel" in
      # These are safe to replace live. module.prop changes on every CI build;
      # installer files affect future installs/uninstalls, not the running stack.
      module.prop|module.prop.bak|webroot/*|META-INF/*|customize.sh|uninstall.sh)
        ;;

      # These participate in boot-time/root mount behavior. Do not pretend they
      # are live-applied: leave KernelSU's staged update intact for next reboot.
      post-fs-data.sh|service.sh|system.prop|sepolicy.rule|system/*|vendor/*|zygisk/*|riru/*|native/*)
        _hi_cc_mode="reboot"
        break
        ;;

      # Features, libraries, action scripts, bundled helpers, config, APK data,
      # scheduler code, etc. are live files but may have running consumers.
      *)
        _hi_cc_mode="runtime"
        ;;
    esac
  done
  IFS="$_hi_cc_old_ifs"
  printf '%s\n' "$_hi_cc_mode"
  unset _hi_cc_changes _hi_cc_mode _hi_cc_old_ifs _hi_cc_rel
}

specter_hot_install() {
  # KernelSU family only; the live-move trick relies on ksu mount internals.
  [ "$ROOT_SOL" = "kernelsu" ] || return 0

  _hi_modid="$(basename "${MODPATH:-}")"
  [ -n "$_hi_modid" ] || return 0
  _hi_live="$MODULES_BASE/$_hi_modid"
  _hi_stage="${MODULES_BASE}_update/$_hi_modid"

  # Updates only; first install still needs a reboot.
  [ -d "$_hi_live" ] || return 0
  [ -d "$_hi_stage" ] || return 0

  _hi_changes="$(_hi_changed_paths "$_hi_live" "$_hi_stage")"
  _hi_mode="$(_hi_classify_changes "$_hi_changes")"

  ui_print "- Hot install requested ($ROOT_TYPE)"
  case "$_hi_mode" in
    reboot)
      ui_print "- Smart hot install: boot-sensitive files changed"
      ui_print "- Update left staged; reboot is required for this build"
      unset _hi_modid _hi_live _hi_stage _hi_changes _hi_mode
      return 0
      ;;
    runtime)
      ui_print "- Smart hot install: runtime update"
      ;;
    *)
      _hi_mode="ui"
      ui_print "- Smart hot install: UI/metadata-only update"
      ;;
  esac

  rm -rf "$_hi_live"
  mv "$_hi_stage" "$_hi_live"

  # Clear the token so the next reboot won't re-run first_boot_setup over an
  # update that was already applied live.
  rm -f "$SPECTER_DIR/.first_boot_pending" 2>/dev/null || true
  _specter_hot_done=1

  rm -f "$SPECTER_DIR/.hotinstall_failed"
  if [ "$_hi_mode" = "runtime" ]; then
    ui_print "- Refreshing Specter runtime (integrity pipeline will NOT run)..."
    if [ -f "$_hi_live/hotinstall.sh" ]; then
      SPECTER_HOT_MODE=runtime sh "$_hi_live/hotinstall.sh" 2>&1 | while IFS= read -r _hiline; do
        [ -n "$_hiline" ] && ui_print "    $_hiline"
      done
    else
      : > "$SPECTER_DIR/.hotinstall_failed"
    fi
  else
    ui_print "- WebUI files replaced live; no integrity/root actions were run"
  fi

  if [ -f "$SPECTER_DIR/.hotinstall_failed" ]; then
    rm -f "$SPECTER_DIR/.hotinstall_failed"
    _hi_apply_failed=1
  fi
  unset _hiline

  # Recreate a stub module.prop so ksu bookkeeping finds it, then clean up later.
  _hi_delay="${SPECTER_HOT_CLEANUP_DELAY:-3}"
  mkdir -p "$_hi_stage"
  cp "$_hi_live/module.prop" "$_hi_stage/module.prop" 2>/dev/null || true
  ( sleep "$_hi_delay"; rm -rf "$_hi_live/update" 2>/dev/null; rm -rf "$_hi_stage" 2>/dev/null ) &

  ui_print "- Refresh/reopen Specter after installation"
  if [ "${_hi_apply_failed:-0}" = "1" ]; then
    ui_print "- WARNING: live runtime refresh failed; reopen Specter or reboot if needed"
  else
    ui_print "- No need to reboot"
  fi

  unset _hi_modid _hi_live _hi_stage _hi_changes _hi_mode _hi_apply_failed _hi_delay
}
