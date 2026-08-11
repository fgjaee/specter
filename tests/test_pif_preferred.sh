plan "pif preferred + imported device seam"

bootstrap
. "$REPO_ROOT/src/lib/pif_preferred.sh"

assert_eq "inject dest" "/data/adb/pif.prop" "$(pif_prop_dest 'Play Integrity Fix [INJECT]')"
assert_eq "fork dest" "/data/adb/modules/playintegrityfix/custom.pif.prop" "$(PIF_DIR=/data/adb/modules/playintegrityfix pif_prop_dest 'Play Integrity Fork')"

_tmp=$(mktemp -d)
printf '%s\n' 'FINGERPRINT=google/blazer/blazer:17/CP2A.1/1:user/release-keys' 'MODEL=Pixel 10 Pro' 'MANUFACTURER=Google' >"$_tmp/ok.prop"
printf '%s\n' 'MODEL=Pixel 10 Pro' >"$_tmp/no_fp.prop"
printf '%s\n' 'FINGERPRINT=google/blazer/blazer:17/CP2A.1/1:user/release-keys' >"$_tmp/no_model.prop"

pif_prop_valid "$_tmp/ok.prop"
assert_eq "valid prop" "0" "$?"

pif_prop_valid "$_tmp/no_fp.prop"
assert_eq "missing fingerprint" "1" "$?"

pif_prop_valid "$_tmp/no_model.prop"
assert_eq "missing model" "1" "$?"

assert_eq "read model" "Pixel 10 Pro" "$(pif_prop_get "$_tmp/ok.prop" MODEL)"

SPECTER_DIR="$_tmp"
mkdir -p "$SPECTER_DIR/pif_imported"
cp "$_tmp/ok.prop" "$SPECTER_DIR/pif_imported/abc.prop"

_choice=$(pif_choose_preferred "Pixel 6|oriole_beta
Pixel 10 Pro|imported:abc")
case "$_choice" in
  "Pixel 6|oriole_beta"|"Pixel 10 Pro|imported:abc") ok "choose picks from preferred pool" ;;
  *) fail "choose picks from preferred pool" "got [$_choice]" ;;
esac

pif_choose_preferred "Gone|imported:missing"
assert_eq "choose fails when imported file missing" "1" "$?"

_choice=$(pif_choose_preferred "Pixel 9 Pro|caiman_beta")
assert_eq "choose keeps canary preferred" "Pixel 9 Pro|caiman_beta" "$_choice"

assert_eq "mirror url product path" \
  "https://fastly.jsdelivr.net/gh/KOWX712/PlayIntegrityFix@bot/device_prop/caiman_beta.prop" \
  "$(pif_bot_mirror_urls 'bot/device_prop/caiman_beta.prop' | head -1)"

assert_eq "canary miner rango path" \
  "https://raw.githubusercontent.com/Vagelis1608/get_the_canary_miner/main/devices/rango.pif.prop" \
  "$(pif_canary_miner_urls 'rango_beta' | head -1)"

_out="$_tmp/data_adb_pif.prop"
pif_apply_imported "abc" "$_out"
assert_file_eq "apply writes prop as-is" "$_out" "$(cat "$_tmp/ok.prop")"

printf '%s\n' 'FINGERPRINT=old' 'MODEL=Old' 'spoofBuild=true' 'spoofProvider=false' >"$_tmp/existing.prop"
printf '%s\n' 'FINGERPRINT=google/blazer/blazer:17/CP2A.1/1:user/release-keys' 'MODEL=Pixel 10 Pro' >"$_tmp/dest.prop"
pif_merge_spoof_keys "$_tmp/existing.prop" "$_tmp/dest.prop"
grep -q '^spoofBuild=true$' "$_tmp/dest.prop"
assert_eq "merge keeps spoofBuild" "0" "$?"

cat >"$_tmp/rango-rich.prop" <<'PROP'
# Build Fields
MANUFACTURER=Google
MODEL=Pixel 10 Pro Fold
FINGERPRINT=google/rango_beta/rango:CANARY/ZP11.260717.006/16004061:user/release-keys
BRAND=google
PRODUCT=rango_beta
DEVICE=rango
SECURITY_PATCH=2026-08-05
# Advanced Settings
spoofBuild=1
spoofProps=1
spoofProvider=0
PROP
pif_write_inject_prop "$_tmp/rango-rich.prop" "$_tmp/rango-normalized.prop"
assert_eq "normalize canary model" "Pixel 10 Pro Fold" "$(pif_prop_get "$_tmp/rango-normalized.prop" MODEL)"
assert_eq "normalize canary patch" "2026-08-05" "$(pif_prop_get "$_tmp/rango-normalized.prop" SECURITY_PATCH)"
grep -q '^spoofProps=' "$_tmp/rango-normalized.prop"
assert_eq "normalize drops source advanced settings" "1" "$?"

# Simulate KOWX missing rango_beta and Canary Miner providing it. The old
# INJECT spoof settings must survive rather than inheriting PIFork defaults.
printf '%s\n' \
  'FINGERPRINT=old' \
  'MODD=Old' \
  'spoofBuild=true' \
  'spoofProps=false' \
  'spoofProvider=false' \
  'spoofSignature=false' \
  'spoofVendingBuild=true' \
  'spoofVendingSdk=false' \
  'DEBUG=false' >"$_tmp/fallback-dest.prop"
log_i() { :; }
download() {
  _url="$1"
  _dst="$2"
  case "$_url" in
    *KOWX712/PlayIntegrityFix*) return 1 ;;
    *Vagelis1608/get_the_canary_miner*'/devices/rango.pif.prop')
      cp "$_tmp/rango-rich.prop" "$_dst"
      return 0
      ;;
  esac
  return 1
}
pif_apply_github_prop "rango_beta" "$_tmp/fallback-dest.prop"
assert_eq "rango fallback applies" "0" "$?"
assert_eq "rango fallback model" "Pixel 10 Pro Fold" "$(pif_prop_get "$_tmp/fallback-dest.prop" MODEL)"
assert_eq "rango fallback preserves spoofProps" "false" "$(pif_prop_get "$_tmp/fallback-dest.prop" spoofProps)"
assert_eq "rango fallback preserves spoofVendingBuild" "true" "$(pif_prop_get "$_tmp/fallback-dest.prop" spoofVendingBuild)"

rm -rf "$_tmp"

# pif_apply_preferred: migrate+imported success, Canary no-net → 2
bootstrap
source_libs
. "$REPO_ROOT/src/lib/pif_preferred.sh"
PIF_DIR="$TEST_ROOT/pif"
mkdir -p "$PIF_DIR" "$SPECTER_DIR/pif_imported"
printf '%s\n' 'FINGERPRINT=google/blazer/blazer:17/CP2A.1/1:user/release-keys' 'MODEL=Pixel 10 Pro' \
  >"$SPECTER_DIR/pif_imported/abc.prop"
set_cfg pif_preferred_product "imported:abc"
set_cfg pif_preferred_model "Pixel 10 Pro"
pif_apply_preferred "Play Integrity Fork"
assert_eq "apply preferred imported" "0" "$?"
assert_file_eq "apply preferred wrote dest" "$PIF_DIR/custom.pif.prop" "$(cat "$SPECTER_DIR/pif_imported/abc.prop")"
set_cfg pif_preferred_devices "Pixel 9 Pro|caiman_beta"
check_network() { return 1; }
pif_apply_preferred "Play Integrity Fork"
assert_eq "apply preferred needs network" "2" "$?"

done_testing
