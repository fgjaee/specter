import { cfgGet, cfgSet } from './cfg.js';
import { showToast } from './toast.js';
import { getTranslation } from './i18n.js';

const t = (key: string, fallback: string): string => getTranslation(key) || fallback;

export function openPropHandlerDialog() {
  const dialog = document.createElement('md-dialog');

  Promise.all([
    cfgGet('toggle_prop_handler', '1'),
    cfgGet('toggle_boot_state_props', '1'),
    cfgGet('toggle_bootmode_spoof', '1'),
  ]).then(([parent, state, bootmode]) => {
    const enabled = parent !== '0';
    const banner = enabled ? '' : `<div style="display:flex;align-items:center;gap:8px;padding:12px 16px;background:var(--md-sys-color-surface-variant);border-radius:12px;margin:0 0 12px 0;color:var(--md-sys-color-on-surface-variant);font-size:0.875rem;"><md-icon>info</md-icon><span>${t('feature_disabled_desc', 'Feature is disabled, enable it in Control to configure')}</span></div>`;
    dialog.innerHTML = `
      <div slot="headline">
        <div class="at-dialog-headline">
          <md-icon aria-hidden="true">lock</md-icon>
          <span>${t('prop_handler_dialog_title', 'Boot State Props')}</span>
        </div>
      </div>
      <div slot="content">
        <p class="at-dialog-desc">${t('prop_handler_dialog_desc', 'Manage boot-time property spoofing and cleanup.')}</p>
        ${banner}
        <div class="list-container at-dialog-list">
          <div class="list-item list-item--toggle">
            <div class="li-icon"><md-icon aria-hidden="true">lock</md-icon></div>
            <div class="list-item-content">
              <div class="toggle-text">${t('prop_handler_boot_state', 'Boot State Props')}</div>
              <span class="supporting-text">${t('prop_handler_boot_state_desc', 'Lock bootloader state, verifiedboot, flash.locked, build type/tags')}</span>
            </div>
            <div class="spacer"></div>
            <md-switch icons id="ph-state" ${state === '1' ? 'selected' : ''} ${enabled ? '' : 'disabled'}></md-switch>
          </div>

          <div class="list-item list-item--toggle">
            <div class="li-icon"><md-icon aria-hidden="true">smartphone</md-icon></div>
            <div class="list-item-content">
              <div class="toggle-text">${t('prop_handler_bootmode', 'Spoof Bootmode')}</div>
              <span class="supporting-text">${t('prop_handler_bootmode_desc', 'Spoof ro.bootmode to normal to hide recovery status')}</span>
            </div>
            <div class="spacer"></div>
            <md-switch icons id="ph-bootmode" ${bootmode === '1' ? 'selected' : ''} ${enabled ? '' : 'disabled'}></md-switch>
          </div>
        </div>
      </div>
      <div slot="actions">
        <md-text-button id="ph-cancel" class="dialog-action-close">${t('dialog_cancel', 'Cancel')}</md-text-button>
        <md-filled-button id="ph-save" ${enabled ? '' : 'disabled'}>${t('dialog_save', 'Save')}</md-filled-button>
      </div>
    `;

    document.body.appendChild(dialog);
    dialog.addEventListener('close', () => document.body.removeChild(dialog));

    const saveBtn = dialog.querySelector('#ph-save') as HTMLButtonElement;
    const cancelBtn = dialog.querySelector('#ph-cancel') as HTMLButtonElement;

    cancelBtn.addEventListener('click', () => dialog.close());

    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      try {
        const s = dialog.querySelector('#ph-state') as MdSwitch;
        const bm = dialog.querySelector('#ph-bootmode') as MdSwitch;
        cfgSet('toggle_boot_state_props', s.selected ? '1' : '0');
        cfgSet('toggle_bootmode_spoof', bm.selected ? '1' : '0');
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
}

export function wirePropHandler() {
  const row = document.getElementById('toggle-prop_handler-row');
  if (!row) return;
  const content = row.querySelector('.list-item-content') as HTMLElement | null;
  if (!content) return;
  content.style.cursor = 'pointer';
  content.addEventListener('click', openPropHandlerDialog);
}
