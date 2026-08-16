plan "conflicts — TEESimulator WebUI feature claims"

bootstrap
source_libs
mk_module teesim "TEESimulator"
mkdir -p "$TEESIM_DIR"
cat > "$CONFIG_DIR/conflicts.txt" << 'EOF'
teesim|TEESimulator WebUI|passive|security_patch,teesim_mode|
EOF

set_cfg "toggle_action_security_patch" "1"

set_cfg "conflict_teesim" "priority_module"
_feature_should_run security_patch && _fsr1=run || _fsr1=skip
assert_eq "claimed: security_patch skipped" "skip" "$_fsr1"
_feature_should_run target && _fsr2=run || _fsr2=skip
assert_eq "unclaimed: target still runs" "run" "$_fsr2"
_feature_should_run keybox && _fsr2b=run || _fsr2b=skip
assert_eq "unclaimed: keybox still runs" "run" "$_fsr2b"

set_cfg "conflict_teesim" "priority_specter"
_feature_should_run security_patch && _fsr3=run || _fsr3=skip
assert_eq "specter priority: security_patch runs" "run" "$_fsr3"

assert_contains "status: teesim listed" "$(conflict_status_json)" '"key":"teesim"'
assert_contains "status: module priority" "$(conflict_status_json)" '"prioritySpecter":true'

# teesim_mode gate
set_cfg "conflict_teesim" "priority_module"
run_feature teesim_mode.sh --get >/dev/null 2>&1
assert_exit_code "mode: refused when claimed" 1 "$?"

set_cfg "conflict_teesim" "priority_specter"
run_feature teesim_mode.sh --get >/dev/null 2>&1
assert_exit_code "mode: allowed when specter priority" 0 "$?"

done_testing
