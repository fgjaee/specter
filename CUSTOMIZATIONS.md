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

## Upstream maintenance

`.github/workflows/sync-upstream.yml` checks `dpejoh/specter:main` every six hours, on manual dispatch, and after local pushes to `main`.

When new upstream commits exist, the workflow merges upstream into a temporary local `main`, runs Specter's TypeScript check, ShellCheck, shell tests, TypeScript tests, full build, and module-structure validation, and only then pushes the validated merge to this fork's `main`. Merge conflicts or failed validation leave `main` unchanged.

This avoids relying on GitHub Actions permission to create pull requests from the fork while still preserving local commits in merge history. Upstream's Telegram upload step remains restricted to `dpejoh/specter`, so this fork does not depend on upstream-only secrets.
