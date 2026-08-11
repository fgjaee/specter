# Local Specter customizations

This fork tracks `dpejoh/specter` and intentionally carries a small set of local enhancements.

## Pixel 10 Pro Fold PIF support

- Keeps **Pixel 10 Pro Fold** (`rango_beta`) selectable in **Choose PIF Device** even while KOWX's `bot/device_list.json` does not list it.
- For Play Integrity Fix **[INJECT]**, Specter still tries the normal KOWX `bot/device_prop/<product>.prop` mirrors first.
- If KOWX has no prop for the selected product, Specter falls back to `Vagelis1608/get_the_canary_miner` using `devices/<codename>.pif.prop`.
- The Canary Miner file is normalized to the INJECT fields Specter needs (`FINGERPRINT`, `MANUFACTURER`, `MODEL`, `SECURITY_PATCH`). PIFork-specific advanced settings from the source file are deliberately ignored.
- Existing local `spoof*`, `DEBUG`, and `verboseLogs` settings are merged back into the generated INJECT prop so a refreshed fingerprint does not silently change spoof policy.

This is a **live fetch**, not a frozen imported prop, so future Canary rotations can update automatically.

## Upstream maintenance

`.github/workflows/sync-upstream.yml` checks `dpejoh/specter:main` every six hours and on manual dispatch. When new upstream commits exist it merges them into the dedicated `sync/upstream-main` branch and opens/updates a pull request against this fork's `main`. Existing fork commits remain in the merge history.

The normal Specter build/test workflow runs on that pull request. Upstream's Telegram upload step is restricted to `dpejoh/specter`, so this fork does not fail because it lacks upstream Telegram secrets.
