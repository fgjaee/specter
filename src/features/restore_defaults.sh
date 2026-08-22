#!/system/bin/sh
set -e
MODDIR=${0%/*}
. "$MODDIR/../lib/common.sh"

log_i "DEFAULTS" "Restoring toggle defaults"
_apply_toggle_defaults force
echo "Default options restored."
exit 0
