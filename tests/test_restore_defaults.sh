plan "restore_defaults"

bootstrap
source_libs
set_cfg toggle_action_gms 0
set_cfg lang en
run_feature restore_defaults.sh >/dev/null
assert_file_eq "overwrites seed key" "$CONFIG_DIR/val/toggle_action_gms.val" "1"
assert_file_eq "leaves other config" "$CONFIG_DIR/val/lang.val" "en"
done_testing
