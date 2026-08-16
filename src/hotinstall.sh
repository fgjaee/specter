#!/system/bin/sh
set -e
MODDIR=${0%/*}

. "$MODDIR/lib/common.sh"
export ROOT_SOL

HOT_MODE="${SPECTER_HOT_MODE:-runtime}"
HOT_LOG="$SPECTER_DIR/log/hotinstall.log"
ensure_dir "$SPECTER_DIR/log" 2>/dev/null || true
log_rotate "$HOT_LOG" 2>/dev/null || true

# Parent reads this marker back; exit status across the streaming pipe isn't
# reliable in every manager WebUI.
rm -f "$SPECTER_DIR/.hotinstall_failed"

{
  log_i "HOT" "Smart hot-install refresh starting (mode=$HOT_MODE)"

  if [ "$HOT_MODE" != "runtime" ]; then
    log_i "HOT" "No runtime refresh requested"
    exit 0
  fi

  # Kill the boot-time scheduler + its inotifyd children so a library/scheduler
  # update cannot leave the previous code resident in the background.
  if [ -f "$SPECTER_DIR/scheduler.pid" ]; then
    _old_pid="$(cat "$SPECTER_DIR/scheduler.pid" 2>/dev/null || true)"
    if [ -n "$_old_pid" ]; then
      for _child in $(pgrep -P "$_old_pid" 2>/dev/null || true); do
        kill "$_child" 2>/dev/null || true
      done
      unset _child
      kill "$_old_pid" 2>/dev/null || true
    fi
    rm -f "$SPECTER_DIR/scheduler.pid" 2>/dev/null || true
    unset _old_pid
  fi

  if [ "$(cfg_get toggle_scheduler 1)" != "0" ]; then
    sh "$MODDIR/lib/scheduler.sh" >"$SPECTER_DIR/log/scheduler.log" 2>&1 &
    log_i "HOT" "Scheduler relaunched (PID $!)"
  else
    log_i "HOT" "Scheduler disabled; nothing to relaunch"
  fi

  # Refresh read-only/status outputs used by the WebUI. Deliberately do NOT run
  # action.sh, PIF fetching, target writes, security-patch writes, keybox
  # installation, Play Store clears, or Google service restarts here.
  log_i "HOT" "Refreshing Specter status files"
  run_device_info "$MODDIR" || log_w "HOT" "Device info refresh failed"
  sh "$MODDIR/features/keybox_info.sh" >/dev/null 2>&1 || log_w "HOT" "Keybox status refresh failed"
  sh "$MODDIR/features/keystore_info.sh" >/dev/null 2>&1 || log_w "HOT" "Keystore status refresh failed"

  if [ -f "$MODDIR/module.prop.bak" ]; then
    cp "$MODDIR/module.prop.bak" "$MODDIR/module.prop" 2>/dev/null || true
  fi
  . "$MODDIR/lib/desc.sh"
  refresh_module_description || true

  log_i "HOT" "Runtime refresh complete; integrity pipeline was not run"
} 2>&1 | tee -a "$HOT_LOG"
