# Local Specter customizations

This fork tracks `dpejoh/specter` and intentionally carries a small set of local enhancements.

## Pixel 10 Pro Fold PIF support

- Keeps **Pixel 10 Pro Fold** (`rango_beta`) selectable in **Choose PIF Device** even while KOWX's `bot/device_list.json` does not list it.
- For Play Integrity Fix **[INJECT]**, Specter still tries the normal KOWX `bot/device_prop/<product>.prop` mirrors first.
- If KOWX has no prop for the selected product, Specter falls back to `Vagelis1608/get_the_canary_miner` using `devices/<codename>.pif.prop`.
- The Canary Miner file is normalized to the INJECT fields Specter needs (`FINGERPRINT`, `MANUFACTURER`, `MODEL`, `SECURITY_PATCH`). PIFork-specific advanced settings from the source file are deliberately ignored.
- Existing local `spoof*`, `DEBUG`, and `verboseLogs` settings are merged back into the generated INJECT prop so a refreshed fingerprint does not silently change spoof policy.

This is a **live fetch**, not a frozen imported prop, so future Canary rotations can update automatically.

## CleveresTricky backend support

- Detects the `cleverestricky` module as its own keystore manager instead of pretending it is Tricky Store.
- Uses CleveresTricky's native data paths under `/data/adb/cleverestricky`: legacy `keybox.xml`, `target.txt`, `security_patch.txt`, and the `global_mode` flag.
- Auto-selection prefers an enabled CleveresTricky backend over TEESimulator, Tricky Store/TEESimulator-RS, and OhMyKeymint. An explicit `keystore_manager` override can still choose another enabled backend; singleton enforcement disables the other keystore providers to avoid simultaneous hooks.
- Specter's keybox installer can write the CleveresTricky legacy `keybox.xml` path. CleveresTricky's own multi-keybox/CBOX pool remains owned by CleveresTricky and is not rewritten by Specter.
- Specter reads and writes CleveresTricky component patch rules. Specter writes full ISO dates for `system`, `vendor`, and `boot`, and can read the legacy compact `YYYYMMDD` form.
- CleveresTricky ignores `target.txt` while its `global_mode` flag exists. Specter therefore allows read-only target diagnostics but blocks manual target writes and skips Auto Target until Global Mode is disabled in CleveresTricky.

### Simplified CleveresTricky control

When CleveresTricky is installed, Specter adds **CleveresTricky — Simple Control** under Keystore Management. The panel talks to CleveresTricky through its own native `webui_bridge` request protocol rather than recreating its private configuration logic.

The simple view explains and reports:

- Keystore/native runtime state and verified keybox count.
- Global versus targeted application scope.
- The five optional v2 identity features: Build, Attestation, Telephony, Region, and Identity Refresh.
- The independent v2 Security Patch feature state.
- `boot_props_mode`, with `auto` called out as the normal coexistence choice when a separate Play Integrity fingerprint provider is installed.
- Auto Keybox Check and DRM passthrough.
- RKP protection as **always on/information only**. Current CleveresTricky retired the old RKP passthrough switch, so Specter does not present it as an RCS troubleshooting toggle.

The panel includes two conservative actions. **Turn optional identity off** changes only the five optional identity feature booleans in CleveresTricky's validated v2 policy and preserves the rest of the policy. **Restore conservative defaults** asks CleveresTricky itself to apply its built-in `default` profile and reload.

### Reversible RCS isolation test

The simple panel also provides an RCS-specific isolation experiment. It is intentionally separate from Play Integrity and does not claim that a Strong Integrity verdict guarantees RCS eligibility.

**Apply RCS isolation test**:

1. Saves the current CleveresTricky `target.txt` and Global Mode state under Specter's backup directory.
2. Switches CleveresTricky to Targeted Mode through CleveresTricky's `/api/toggle` interface.
3. Uses CleveresTricky's validated `/api/save` interface to keep the Play Integrity-side packages in CleveresTricky scope (`GMS`, Play Store, GSF, SafetyCore, Contact Keys, Wallet and `android`).
4. Deliberately leaves Google Messages and `com.google.android.ims` outside CleveresTricky scope so the RCS applications use Android's genuine Keystore path.
5. Reloads CleveresTricky without clearing application data.

A separate **Restart RCS apps** action only force-stops Google Messages and Google IMS so they can be reopened for a clean retry. It does not clear Messages, Carrier Services, GMS, GSF, or Play Store data.

**Restore previous scope** restores the saved target file and the previous Global Mode state through CleveresTricky's validated interfaces, then removes the temporary RCS backup marker.

The RCS mode is a controlled diagnostic for cases where RCS security eligibility fails while Play Integrity still passes. It tests whether CleveresTricky interception of the RCS-side applications is part of the failure; it does not alter the PIF fingerprint and does not guarantee a server-side RCS verdict.

## Upstream maintenance

`.github/workflows/sync-upstream.yml` checks `dpejoh/specter:main` every six hours, on manual dispatch, and after local pushes to `main`.

When new upstream commits exist, the workflow merges upstream into a temporary local `main`, runs Specter's TypeScript check, ShellCheck, shell tests, TypeScript tests, full build, and module-structure validation, and only then pushes the validated merge to this fork's `main`. Merge conflicts or failed validation leave `main` unchanged.

This avoids relying on GitHub Actions permission to create pull requests from the fork while still preserving local commits in merge history. Upstream's Telegram upload step remains restricted to `dpejoh/specter`, so this fork does not depend on upstream-only secrets.
