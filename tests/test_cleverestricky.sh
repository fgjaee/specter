#!/bin/sh
# shellcheck shell=sh
. "$(dirname "$0")/helpers.sh"
. "$(dirname "$0")/mock_env.sh"

plan "CleveresTricky backend, patch compatibility, Global Mode, and RCS-safe targeting"

bootstrap
source_libs
mk_module cleverestricky "CleveresTricky"
mkdir -p "$CLEVERES_DIR"
detect_keystore_manager
assert_eq "detect: cleveres backend" "cleveres" "$KSM"
assert_eq "detect: cleveres name" "CleveresTricky" "$KSM_NAME"
assert_eq "detect: cleveres format" "txt" "$KSM_FORMAT"
assert_eq "detect: cleveres has no suffix modes" "0" "$KSM_PER_APP_MODES"
assert_eq "detect: cleveres dir" "$CLEVERES_DIR" "$KSM_DIR"
assert_eq "detect: cleveres keybox" "$CLEVERES_KEYBOX" "$KSM_KEYBOX"
assert_eq "detect: cleveres targets" "$CLEVERES_TARGETS" "$KSM_TARGETS"
assert_eq "detect: cleveres config" "$CLEVERES_SECURITY" "$KSM_CONFIG"

bootstrap
source_libs
mk_module cleverestricky "CleveresTricky"
mk_module teesim "TEESimulator"
mk_module tricky_store "Tricky Store"
mk_module oh_my_keymint "OhMyKeymint"
mkdir -p "$CLEVERES_DIR" "$TEESIM_DIR" "$OMK_DIR"
detect_keystore_manager
assert_eq "detect: cleveres auto priority" "cleveres" "$KSM"

bootstrap
source_libs
mk_module cleverestricky "CleveresTricky"
mkdir -p "$CLEVERES_DIR"
detect_keystore_manager
set_prop ro.vendor.build.security_patch "2026-08-05"
ksm_set_security_patch "2026-08-05"
assert_contains "patch: cleveres system full date" "$(cat "$CLEVERES_SECURITY")" "system=2026-08-05"
assert_contains "patch: cleveres boot full date" "$(cat "$CLEVERES_SECURITY")" "boot=2026-08-05"
assert_contains "patch: cleveres vendor full date" "$(cat "$CLEVERES_SECURITY")" "vendor=2026-08-05"
assert_eq "patch: cleveres read" "2026-08-05" "$(ksm_get_security_patch)"
printf '20260805\n' > "$CLEVERES_SECURITY"
assert_eq "patch: compact legacy date read" "2026-08-05" "$(ksm_get_security_patch)"

bootstrap
source_libs
mk_module cleverestricky "CleveresTricky"
mkdir -p "$CLEVERES_DIR"
printf 'com.example.one\n' > "$CLEVERES_TARGETS"
detect_keystore_manager
ksm_target_management_available
assert_eq "target: targeted mode writable" "0" "$?"
touch "$CLEVERES_GLOBAL_MODE"
ksm_target_management_available
assert_eq "target: global mode blocks writes" "1" "$?"
_out=$(run_feature target.sh --list 2>&1); _rc=$?
assert_eq "target: global mode list allowed" "0" "$_rc"
assert_contains "target: global mode list content" "$_out" "com.example.one"
_input="$TEST_ROOT/global_input.txt"
printf 'com.example.two\n' > "$_input"
_out=$(run_feature target.sh --set "$_input" 2>&1); _rc=$?
assert_eq "target: global mode set rejected" "1" "$_rc"
assert_contains "target: global mode message" "$_out" "Global Mode is enabled"

bootstrap
source_libs
mk_module cleverestricky "CleveresTricky"
mkdir -p "$CLEVERES_DIR"
touch "$SPECTER_DIR/rcs_safe_mode"
_input="$TEST_ROOT/rcs_safe_input.txt"
printf '%s\n' \
  'com.example.extra' \
  'com.google.android.apps.messaging' \
  'com.google.android.ims' > "$_input"
_out=$(run_feature target.sh --set "$_input" 2>&1); _rc=$?
assert_eq "rcs safe: target set succeeds" "0" "$_rc"
_target=$(cat "$CLEVERES_TARGETS")
assert_contains "rcs safe: keeps requested extra" "$_target" "com.example.extra"
assert_contains "rcs safe: requires android" "$_target" "android"
assert_contains "rcs safe: requires GMS" "$_target" "com.google.android.gms"
assert_contains "rcs safe: requires Key Attestation" "$_target" "io.github.vvb2060.keyattestation"
assert_not_contains "rcs safe: excludes Messages" "$_target" "com.google.android.apps.messaging"
assert_not_contains "rcs safe: excludes Google IMS" "$_target" "com.google.android.ims"

printf '%s\n' \
  'android' \
  'com.google.android.gms' \
  'com.google.android.apps.messaging' \
  'com.google.android.ims' > "$CLEVERES_TARGETS"
_out=$(run_feature target.sh --merge 2>&1); _rc=$?
assert_eq "rcs safe: merge succeeds" "0" "$_rc"
_target=$(cat "$CLEVERES_TARGETS")
assert_contains "rcs safe: merge restores Key Attestation" "$_target" "io.github.vvb2060.keyattestation"
assert_not_contains "rcs safe: merge prunes Messages" "$_target" "com.google.android.apps.messaging"
assert_not_contains "rcs safe: merge prunes Google IMS" "$_target" "com.google.android.ims"

printf '%s\n' \
  'android' \
  'com.google.android.gms' \
  'com.google.android.apps.messaging' \
  'com.google.android.ims' > "$CLEVERES_TARGETS"
_out=$(run_feature auto_target.sh 2>&1); _rc=$?
assert_eq "rcs safe: auto target succeeds" "0" "$_rc"
_target=$(cat "$CLEVERES_TARGETS")
assert_contains "rcs safe: auto target keeps Key Attestation" "$_target" "io.github.vvb2060.keyattestation"
assert_not_contains "rcs safe: auto target prunes Messages" "$_target" "com.google.android.apps.messaging"
assert_not_contains "rcs safe: auto target prunes Google IMS" "$_target" "com.google.android.ims"

unset _input _out _rc _target
cleanup
done_testing
