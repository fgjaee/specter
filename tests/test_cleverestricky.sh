plan "CleveresTricky backend detection, paths, patches, conflicts, Global Mode, and RCS-safe targeting"

# ---------- detection and paths ----------
bootstrap
source_libs
mk_module cleverestricky "CleveresTricky"
mkdir -p "$CLEVERES_DIR"
detect_keystore_manager
assert_eq "detect: cleveres backend" "cleveres" "$KSM"
assert_eq "detect: cleveres name" "CleveresTricky" "$KSM_NAME"
assert_eq "detect: cleveres format" "txt" "$KSM_FORMAT"
assert_eq "detect: cleveres dir" "$CLEVERES_DIR" "$KSM_DIR"
assert_eq "detect: cleveres keybox" "$CLEVERES_KEYBOX" "$KSM_KEYBOX"
assert_eq "detect: cleveres targets" "$CLEVERES_TARGETS" "$KSM_TARGETS"
assert_eq "detect: cleveres security" "$CLEVERES_SECURITY" "$KSM_SECURITY"

# Stale data directory alone must not select a disabled/uninstalled backend.
bootstrap
source_libs
mkdir -p "$CLEVERES_DIR"
detect_keystore_manager
assert_eq "detect: stale cleveres dir ignored" "none" "$KSM"

# Cleveres wins auto-selection when multiple enabled keystore backends exist.
bootstrap
source_libs
mk_module cleverestricky "CleveresTricky"
mk_module teesim "TEESimulator"
mk_module tricky_store "Tricky Store"
mk_module oh_my_keymint "OhMyKeymint"
mkdir -p "$CLEVERES_DIR" "$TEESIM_DIR" "$OMK_DIR"
detect_keystore_manager
assert_eq "detect: cleveres priority" "cleveres" "$KSM"

# Explicit override remains possible and singleton disables Cleveres when it loses.
bootstrap
source_libs
mk_module cleverestricky "CleveresTricky"
mk_module tricky_store "Tricky Store"
mkdir -p "$CLEVERES_DIR"
set_cfg keystore_manager trickystore
ksm_enforce_singleton >/dev/null
assert_file_exists "singleton: explicit trickystore disables cleveres" "$CLEVERES_MODULE/disable"
detect_keystore_manager
assert_eq "detect: explicit trickystore" "trickystore" "$KSM"

# Auto singleton keeps Cleveres and disables lower-priority enabled providers.
bootstrap
source_libs
mk_module cleverestricky "CleveresTricky"
mk_module tricky_store "Tricky Store"
mk_module oh_my_keymint "OhMyKeymint"
mkdir -p "$CLEVERES_DIR" "$OMK_DIR"
ksm_enforce_singleton >/dev/null
assert_file_not_exists "singleton: cleveres stays enabled" "$CLEVERES_MODULE/disable"
assert_file_exists "singleton: tricky_store disabled" "$MODULES_BASE/tricky_store/disable"
assert_file_exists "singleton: omk disabled" "$OMK_MODULE/disable"

# ---------- security patch compatibility ----------
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

# Legacy compact Cleveres patch syntax is also understood for display/migration.
printf '20260805\n' > "$CLEVERES_SECURITY"
assert_eq "patch: compact date read" "2026-08-05" "$(ksm_get_security_patch)"

# ---------- keybox compatibility ----------
bootstrap
source_libs
mk_module cleverestricky "CleveresTricky"
mkdir -p "$CLEVERES_DIR"
detect_keystore_manager
printf '<AndroidAttestation/>\n' > "$TEST_ROOT/cleveres_keybox.xml"
ksm_install_keybox "$TEST_ROOT/cleveres_keybox.xml" copy
assert_contains "keybox: installed to Cleveres legacy path" "$(cat "$CLEVERES_KEYBOX")" "<AndroidAttestation/>"

# ---------- target / Global Mode safety ----------
bootstrap
source_libs
mk_module cleverestricky "CleveresTricky"
mkdir -p "$CLEVERES_DIR"
printf 'com.example.one\n' > "$CLEVERES_TARGETS"
detect_keystore_manager
ksm_target_management_available
assert_eq "target: targeted mode writable" "0" "$?"

# Cleveres current default profile uses a regular global_mode flag file.
touch "$CLEVERES_GLOBAL_MODE"
ksm_target_management_available
assert_eq "target: global mode blocks Specter writes" "1" "$?"

_out=$(run_feature target.sh --set "$CLEVERES_TARGETS" 2>&1); _rc=$?
assert_eq "target: global mode set rejected" "1" "$_rc"
assert_contains "target: global mode message" "$_out" "Global Mode is enabled"

_out=$(run_feature auto_target.sh 2>&1); _rc=$?
assert_eq "auto target: global mode safe skip" "0" "$_rc"
assert_contains "auto target: global mode skip logged" "$_out" "Global Mode is active"

# Read-only target diagnostics stay available in Global Mode.
_out=$(run_feature target.sh --list 2>&1); _rc=$?
assert_eq "target: global mode list allowed" "0" "$_rc"
assert_contains "target: global mode list content" "$_out" "com.example.one"

# ---------- proven RCS-safe Cleveres scope ----------
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
assert_contains "rcs safe: keeps requested extra" "$(cat "$CLEVERES_TARGETS")" "com.example.extra"
assert_contains "rcs safe: requires android" "$(cat "$CLEVERES_TARGETS")" "android"
assert_contains "rcs safe: requires gms" "$(cat "$CLEVERES_TARGETS")" "com.google.android.gms"
assert_contains "rcs safe: requires key attestation" "$(cat "$CLEVERES_TARGETS")" "io.github.vvb2060.keyattestation"
assert_not_contains "rcs safe: excludes Messages" "$(cat "$CLEVERES_TARGETS")" "com.google.android.apps.messaging"
assert_not_contains "rcs safe: excludes Google IMS" "$(cat "$CLEVERES_TARGETS")" "com.google.android.ims"

# A later merge (including action.sh's normal target merge) must not undo RCS safety.
printf '%s\n' \
  'android' \
  'com.google.android.gms' \
  'com.google.android.apps.messaging' \
  'com.google.android.ims' > "$CLEVERES_TARGETS"
_out=$(run_feature target.sh --merge 2>&1); _rc=$?
assert_eq "rcs safe: merge succeeds" "0" "$_rc"
assert_contains "rcs safe: merge restores Key Attestation" "$(cat "$CLEVERES_TARGETS")" "io.github.vvb2060.keyattestation"
assert_not_contains "rcs safe: merge prunes Messages" "$(cat "$CLEVERES_TARGETS")" "com.google.android.apps.messaging"
assert_not_contains "rcs safe: merge prunes Google IMS" "$(cat "$CLEVERES_TARGETS")" "com.google.android.ims"

# Background Auto Target also cleans a stale protected entry while retaining the core.
printf '%s\n' \
  'android' \
  'com.google.android.gms' \
  'com.google.android.apps.messaging' \
  'com.google.android.ims' > "$CLEVERES_TARGETS"
_out=$(run_feature auto_target.sh 2>&1); _rc=$?
assert_eq "rcs safe: auto target succeeds" "0" "$_rc"
assert_contains "rcs safe: auto target keeps Key Attestation" "$(cat "$CLEVERES_TARGETS")" "io.github.vvb2060.keyattestation"
assert_not_contains "rcs safe: auto target prunes Messages" "$(cat "$CLEVERES_TARGETS")" "com.google.android.apps.messaging"
assert_not_contains "rcs safe: auto target prunes Google IMS" "$(cat "$CLEVERES_TARGETS")" "com.google.android.ims"

unset _input _out _rc

done_testing
