import '@material/web/labs/segmentedbuttonset/outlined-segmented-button-set.js';
import '@material/web/labs/segmentedbutton/outlined-segmented-button.js';
import '@material/web/button/filled-button.js';
import { cfgGet, cfgSet } from './cfg.js';
import { showToast } from './toast.js';
import { getTranslation } from './i18n.js';
import { wireRowDialog } from './toggles.js';

const t = (key: string, fallback: string): string => getTranslation(key) || fallback;

export function openAutoTargetDialog() {
  const dialog = document.createElement('md-dialog');
  dialog.id = 'auto-target-dialog';

  Promise.all([
    cfgGet('auto_target_method', 'instant'),
    cfgGet('auto_target_interval', '300'),
  ]).then(([method, interval]) => {
    const isPolling = method === 'polling';
    dialog.innerHTML = `
      <div slot="headline">
        <div class="at-dialog-headline">
          <md-icon aria-hidden="true">update</md-icon>
          <span>${t('auto_target_title', 'Auto Targeting')}</span>
        </div>
      </div>
      <div slot="content">
        <p class="at-dialog-desc">${t('auto_target_desc', 'Automatically watches for newly installed apps and adds them to Tricky Store target.txt.')}</p>

        <div class="at-method-section">
          <div class="at-method-label">${t('auto_target_method', 'Detection Method')}</div>
          <md-outlined-segmented-button-set>
            <md-outlined-segmented-button value="instant"${method === 'instant' ? ' selected' : ''}>
              <md-icon slot="icon">bolt</md-icon>
              ${t('auto_target_method_instant', 'Instant')}
            </md-outlined-segmented-button>
            <md-outlined-segmented-button value="polling"${method === 'polling' ? ' selected' : ''}>
              <md-icon slot="icon">schedule</md-icon>
              ${t('auto_target_method_polling', 'Polling')}
            </md-outlined-segmented-button>
          </md-outlined-segmented-button-set>
          <div class="at-method-help" id="at-help">${isPolling ? t('auto_target_method_polling_help', 'Checks periodically at a set interval') : t('auto_target_method_instant_help', 'Detects new installs immediately via inotifyd (recommended)')}</div>
        </div>

        <div class="list-container at-dialog-list${isPolling ? '' : ' at-hidden'}" id="at-interval-row">
          <div class="list-item">
            <div class="li-icon"><md-icon aria-hidden="true">timer</md-icon></div>
            <div class="list-item-content">
              <div class="toggle-text">${t('auto_target_interval', 'Interval (seconds)')}</div>
              <span class="supporting-text">${t('auto_target_interval_desc', 'How often to check for new apps. Minimum 3 seconds.')}</span>
            </div>
            <div class="spacer"></div>
            <input type="number" id="at-interval" class="at-interval-input" min="3" value="${interval}" aria-label="${t('auto_target_interval_aria', 'Interval in seconds')}">
          </div>
        </div>
      </div>
      <div slot="actions">
        <md-text-button id="at-cancel">${t('dialog_cancel', 'Cancel')}</md-text-button>
        <md-filled-button id="at-save">${t('dialog_save', 'Save')}</md-filled-button>
      </div>
    `;

    document.body.appendChild(dialog);
    dialog.addEventListener('close', () => document.body.removeChild(dialog));

    const helpEl = dialog.querySelector('#at-help') as HTMLElement;
    const intervalRow = dialog.querySelector('#at-interval-row') as HTMLElement;
    const intervalInput = dialog.querySelector('#at-interval') as HTMLInputElement;
    const saveBtn = dialog.querySelector('#at-save') as HTMLElement;
    const cancelBtn = dialog.querySelector('#at-cancel') as HTMLElement;

    let currentMethod = method;

    function updateIntervalRow(polling: boolean) {
      helpEl.textContent = polling
        ? t('auto_target_method_polling_help', 'Checks periodically at a set interval')
        : t('auto_target_method_instant_help', 'Detects new installs immediately via inotifyd (recommended)');
      intervalRow.classList.toggle('at-hidden', !polling);
    }

    dialog.querySelectorAll('md-outlined-segmented-button').forEach(btn => {
      btn.addEventListener('click', () => {
        currentMethod = btn.getAttribute('value') || 'instant';
        updateIntervalRow(currentMethod === 'polling');
      });
    });
    updateIntervalRow(isPolling);

    cancelBtn.addEventListener('click', () => dialog.close());

    saveBtn.addEventListener('click', () => {
      const num = parseInt(intervalInput.value || '15', 10);
      cfgSet('auto_target_method', currentMethod);
      cfgSet('auto_target_interval', String(Math.max(3, num)));
      showToast(t('auto_target_saved', 'Auto targeting settings saved'), { icon: 'check_circle', type: 'success', autoCloseDelay: 2500 });
      dialog.close();
    });

    dialog.show();
  });
}

export function wireAutoTarget() {
  wireRowDialog('toggle-background_auto_target-row', openAutoTargetDialog);
}
