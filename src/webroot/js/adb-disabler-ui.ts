import { cfgGet, cfgSet } from './cfg.js';
import { showToast } from './toast.js';
import { getTranslation } from './i18n.js';
import { wireRowDialog } from './toggles.js';

const t = (key: string, fallback: string): string => getTranslation(key) || fallback;

export function openAdbDisablerDialog() {
  const dialog = document.createElement('md-dialog');

  cfgGet('toggle_adb_disabler', '1').then(parent => {
    const enabled = parent !== '0';
    Promise.all([
      cfgGet('toggle_adb_disabler_dev_options', '1'),
      cfgGet('toggle_adb_disabler_usb_debug', '1'),
      cfgGet('toggle_adb_disabler_oem_unlock', '1'),
    ]).then(([devOpt, usbDbg, oemUnlock]) => {
      const banner = enabled ? '' : `<div style="display:flex;align-items:center;gap:8px;padding:12px 16px;background:var(--md-sys-color-surface-variant);border-radius:12px;margin:0 0 12px 0;color:var(--md-sys-color-on-surface-variant);font-size:0.875rem;"><md-icon>info</md-icon><span>${t('feature_disabled_desc', 'Feature is disabled, enable it in Control to configure')}</span></div>`;
      dialog.innerHTML = `
        <div slot="headline">
          <div class="at-dialog-headline">
            <md-icon aria-hidden="true">usb_off</md-icon>
            <span>${t('control_toggle_adb_disabler', 'ADB Disabler')}</span>
          </div>
        </div>
        <div slot="content">
          <p class="at-dialog-desc">${t('adb_disabler_dialog_desc', 'Choose which developer settings to disable at boot.')}</p>
          ${banner}
          <div class="list-container at-dialog-list">
            <div class="list-item list-item--toggle">
              <div class="li-icon"><md-icon aria-hidden="true">developer_mode</md-icon></div>
              <div class="list-item-content">
                <div class="toggle-text">${t('adb_disabler_dev_options', 'Disable Developer Options')}</div>
                <span class="supporting-text">${t('adb_disabler_dev_options_desc', 'Disables developer options toggle in Settings')}</span>
              </div>
              <div class="spacer"></div>
              <md-switch icons id="adb-dev-options" ${devOpt === '1' ? 'selected' : ''} ${enabled ? '' : 'disabled'}></md-switch>
            </div>

            <div class="list-item list-item--toggle">
              <div class="li-icon"><md-icon aria-hidden="true">adb</md-icon></div>
              <div class="list-item-content">
                <div class="toggle-text">${t('adb_disabler_usb_debug', 'Disable USB Debugging')}</div>
                <span class="supporting-text">${t('adb_disabler_usb_debug_desc', 'Disables ADB, strips adb from USB config, locks OEM unlock')}</span>
              </div>
              <div class="spacer"></div>
              <md-switch icons id="adb-usb-debug" ${usbDbg === '1' ? 'selected' : ''} ${enabled ? '' : 'disabled'}></md-switch>
            </div>

            <div class="list-item list-item--toggle">
              <div class="li-icon"><md-icon aria-hidden="true">lock_outline</md-icon></div>
              <div class="list-item-content">
                <div class="toggle-text">${t('adb_disabler_oem_unlock', 'Hide OEM Unlock Support')}</div>
                <span class="supporting-text">${t('adb_disabler_oem_unlock_desc', 'Hides OEM unlock toggle from developer options')}</span>
              </div>
              <div class="spacer"></div>
              <md-switch icons id="adb-oem-unlock" ${oemUnlock === '1' ? 'selected' : ''} ${enabled ? '' : 'disabled'}></md-switch>
            </div>
          </div>
        </div>
        <div slot="actions">
          <md-text-button id="adb-cancel" class="dialog-action-close">${t('dialog_cancel', 'Cancel')}</md-text-button>
          <md-filled-button id="adb-save" ${enabled ? '' : 'disabled'}>${t('dialog_save', 'Save')}</md-filled-button>
        </div>
      `;

      document.body.appendChild(dialog);
      dialog.addEventListener('close', () => document.body.removeChild(dialog));

      const devToggle = dialog.querySelector('#adb-dev-options') as MdSwitch;
      const usbToggle = dialog.querySelector('#adb-usb-debug') as MdSwitch;
      const oemToggle = dialog.querySelector('#adb-oem-unlock') as MdSwitch;
      const saveBtn = dialog.querySelector('#adb-save') as HTMLButtonElement;
      const cancelBtn = dialog.querySelector('#adb-cancel') as HTMLButtonElement;

      cancelBtn.addEventListener('click', () => dialog.close());

      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;

        try {
          cfgSet('toggle_adb_disabler_dev_options', devToggle.selected ? '1' : '0');
          cfgSet('toggle_adb_disabler_usb_debug', usbToggle.selected ? '1' : '0');
          cfgSet('toggle_adb_disabler_oem_unlock', oemToggle.selected ? '1' : '0');

          showToast(t('toast_success', 'Done'), { icon: 'check_circle', type: 'success', autoCloseDelay: 2500 });
          dialog.close();
        } catch (e) {
          showToast(t('simple_toast_error', 'Failed'), { icon: 'error', type: 'error', autoCloseDelay: 3000 });
        } finally {
          saveBtn.disabled = false;
        }
      });

      dialog.show();
    });
  });
}

export function wireAdbDisabler() {
  wireRowDialog('toggle-adb_disabler-row', openAdbDisablerDialog);
}
