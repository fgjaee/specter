plan "lib/hotinstall.sh — gates, smart modes, cleanup, apply failure"

_hi_setup() {
  # The shared test harness mocks find for unrelated boot-script tests. Smart
  # hot-install classification needs the real filesystem find/cmp/readlink.
  PATH="/usr/bin:/bin:$BIN_DIR"
  export PATH

  _modid="${1:-specter}"
  ROOT_SOL="kernelsu"
  ROOT_TYPE="KernelSU"
  _mods_update="${MODULES_BASE}_update"
  MODPATH="$_mods_update/$_modid"
  STAGE="$MODPATH"
  LIVE="$MODULES_BASE/$_modid"

  rm -rf "$LIVE" "$_mods_update"
  mkdir -p "$LIVE"
  printf 'id=%s\nname=OldVersion\nversionCode=1\n' "$_modid" > "$LIVE/module.prop"

  mkdir -p "$STAGE"
  printf 'id=%s\nname=NewVersion\nversionCode=2\n' "$_modid" > "$STAGE/module.prop"
  _hi_exec_rc="${2:-0}"
  if [ "$_hi_exec_rc" = "0" ]; then
    cat > "$STAGE/hotinstall.sh" <<'EOF'
#!/bin/sh
echo stub-running
echo ran > "$(dirname "$0")/hi.ran"
echo "${SPECTER_HOT_MODE:-}" > "$(dirname "$0")/hi.mode"
exit 0
EOF
  else
    cat > "$STAGE/hotinstall.sh" <<EOF
#!/bin/sh
echo stub-running
echo ran > "\$(dirname "\$0")/hi.ran"
echo "\${SPECTER_HOT_MODE:-}" > "\$(dirname "\$0")/hi.mode"
: > "$SPECTER_DIR/.hotinstall_failed"
exit $_hi_exec_rc
EOF
  fi
  chmod +x "$STAGE/hotinstall.sh"

  : > "$SPECTER_DIR/.first_boot_pending"

  UI_LOG="$TEST_ROOT/ui.log"; : > "$UI_LOG"
  ui_print() { echo "$@" >> "$UI_LOG"; }

  SPECTER_HOT_CLEANUP_DELAY=0
  export SPECTER_HOT_CLEANUP_DELAY
  unset _modid _hi_exec_rc
}

. "$REPO_ROOT/src/lib/hotinstall.sh"

# ---- APatch skipped ----
bootstrap
source_libs
_hi_setup
ROOT_SOL="apatch"
specter_hot_install
assert_file_eq "apatch: live unchanged" "$LIVE/module.prop" "$(printf 'id=specter\nname=OldVersion\nversionCode=1\n')"
assert_eq "apatch: no hot-done" "" "${_specter_hot_done:-}"
assert_file_exists "apatch: staging intact" "$STAGE/module.prop"

# ---- first install skipped ----
bootstrap
source_libs
_hi_setup
rm -rf "$LIVE"
specter_hot_install
assert_file_exists "first-install: staging intact" "$STAGE/module.prop"
assert_eq "first-install: no hot-done" "" "${_specter_hot_done:-}"

# ---- UI-only update: swap files, do not execute runtime refresher ----
bootstrap
source_libs
_hi_setup
cp "$STAGE/hotinstall.sh" "$LIVE/hotinstall.sh"
chmod +x "$LIVE/hotinstall.sh"
mkdir -p "$LIVE/webroot" "$STAGE/webroot"
printf 'old-ui\n' > "$LIVE/webroot/index.html"
printf 'new-ui\n' > "$STAGE/webroot/index.html"
specter_hot_install
assert_file_eq "ui: live webroot updated" "$LIVE/webroot/index.html" "new-ui"
assert_file_not_exists "ui: runtime executor skipped" "$LIVE/hi.ran"
assert_file_not_exists "ui: first_boot_pending cleared" "$SPECTER_DIR/.first_boot_pending"
assert_eq "ui: hot-done set" "1" "${_specter_hot_done:-}"
_ui="$(cat "$UI_LOG")"
assert_contains "ui: classified" "$_ui" "UI/metadata-only update"
assert_contains "ui: no integrity/root actions" "$_ui" "no integrity/root actions were run"
assert_contains "ui: no reboot" "$_ui" "No need to reboot"

# ---- Boot-sensitive update: keep stage for reboot ----
bootstrap
source_libs
_hi_setup
cp "$STAGE/hotinstall.sh" "$LIVE/hotinstall.sh"
chmod +x "$LIVE/hotinstall.sh"
printf 'old-postfs\n' > "$LIVE/post-fs-data.sh"
printf 'new-postfs\n' > "$STAGE/post-fs-data.sh"
specter_hot_install
assert_file_eq "reboot: live untouched" "$LIVE/post-fs-data.sh" "old-postfs"
assert_file_eq "reboot: stage preserved" "$STAGE/post-fs-data.sh" "new-postfs"
assert_file_exists "reboot: pending token preserved" "$SPECTER_DIR/.first_boot_pending"
assert_eq "reboot: no hot-done" "" "${_specter_hot_done:-}"
_ui="$(cat "$UI_LOG")"
assert_contains "reboot: classified" "$_ui" "boot-sensitive files changed"
assert_contains "reboot: explicit requirement" "$_ui" "reboot is required"
assert_not_contains "reboot: no false promise" "$_ui" "No need to reboot"

# ---- KSU runtime happy path ----
bootstrap
source_libs
_hi_setup
specter_hot_install
assert_file_eq "ksu: live updated" "$LIVE/module.prop" "$(printf 'id=specter\nname=NewVersion\nversionCode=2\n')"
assert_file_exists "ksu: runtime executor ran" "$LIVE/hi.ran"
assert_file_eq "ksu: runtime mode passed" "$LIVE/hi.mode" "runtime"
assert_file_not_exists "ksu: first_boot_pending cleared" "$SPECTER_DIR/.first_boot_pending"
assert_eq "ksu: hot-done set" "1" "${_specter_hot_done:-}"
_ui="$(cat "$UI_LOG")"
assert_contains "ksu: announces hot install" "$_ui" "Hot install requested"
assert_contains "ksu: runtime classified" "$_ui" "runtime update"
assert_contains "ksu: integrity pipeline skipped" "$_ui" "integrity pipeline will NOT run"
assert_contains "ksu: no reboot promised" "$_ui" "No need to reboot"
assert_not_contains "ksu: no warning" "$_ui" "WARNING"

# ---- cleanup dance ----
bootstrap
source_libs
_hi_setup
specter_hot_install
assert_file_exists "dance: stub module.prop" "${STAGE}/module.prop"
sleep 1
assert_file_not_exists "dance: staging removed" "${STAGE}/module.prop"
assert_file_not_exists "dance: update marker gone" "$LIVE/update"

# ---- apply failure ----
bootstrap
source_libs
_hi_setup "specter" 1
specter_hot_install
assert_file_eq "fail: live still updated" "$LIVE/module.prop" "$(printf 'id=specter\nname=NewVersion\nversionCode=2\n')"
assert_eq "fail: hot-done still set" "1" "${_specter_hot_done:-}"
_ui="$(cat "$UI_LOG")"
assert_contains "fail: warns" "$_ui" "WARNING: live runtime refresh failed"
assert_not_contains "fail: no no-reboot promise" "$_ui" "No need to reboot"

# ---- production runtime refresher must remain non-invasive ----
_prod_hot="$(cat "$REPO_ROOT/src/hotinstall.sh")"
assert_not_contains "runtime refresher: no full action" "$_prod_hot" 'sh "$MODDIR/action.sh"'
assert_not_contains "runtime refresher: no Play Store clear" "$_prod_hot" 'kill_play_store'
assert_contains "runtime refresher: documents no integrity pipeline" "$_prod_hot" "integrity pipeline was not run"

done_testing
