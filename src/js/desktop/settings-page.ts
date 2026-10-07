import {
  ensureDesktopModules,
  getBridge,
  type DesktopModuleName,
  type ModuleStatus,
} from './bridge.js';
import { applyDesktopStrings, desktopLang, ds } from './strings.js';
import { THEME_EVENT, currentTheme, setTheme } from './theme.js';
import {
  changeLanguage,
  getLanguageFromUrl,
  languageNames,
} from '../i18n/i18n.js';
import { orderedLanguages } from '../i18n/language-switcher.js';

function formatSize(bytes: number): string {
  return bytes > 0 ? `~${(bytes / (1024 * 1024)).toFixed(0)} MB` : '';
}

const MODULE_ICONS: Record<string, string> = {
  cpdf: 'ph-file-pdf',
  pymupdf: 'ph-file-doc',
  ghostscript: 'ph-file-archive',
  libreoffice: 'ph-files',
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = ''
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function button(
  label: string,
  icon: string,
  className: string,
  onClick: () => void
) {
  const btn = el('button', `desktop-module-btn ${className}`);
  btn.type = 'button';
  btn.append(el('i', `ph ${icon} text-base`), el('span', '', label));
  btn.addEventListener('click', onClick);
  return btn;
}

async function download(names: DesktopModuleName[]): Promise<void> {
  try {
    await ensureDesktopModules(names);
  } catch (e) {
    console.warn('[Desktop] Module download did not complete:', e);
  }
  await render();
}

/** "Name (what it is for)" -> the two parts, for a title and a subtitle. */
function splitLabel(label: string): { name: string; purpose: string } {
  const match = /^([^(]+)\((.+)\)\s*$/.exec(label);
  return match
    ? { name: match[1].trim(), purpose: match[2].trim() }
    : { name: label, purpose: '' };
}

function moduleRow(mod: ModuleStatus): HTMLElement {
  const row = el('div', 'desktop-module-row');

  const icon = el('div', 'desktop-module-icon');
  icon.append(el('i', `ph ${MODULE_ICONS[mod.name] ?? 'ph-cube'}`));

  const { name, purpose } = splitLabel(
    mod.label[desktopLang()] || mod.label.en || mod.name
  );
  const info = el('div', 'min-w-0 flex-1');
  const heading = el('div', 'flex flex-wrap items-center gap-2');
  heading.append(
    el('h3', 'text-sm font-semibold text-white', name),
    el(
      'span',
      `desktop-badge ${mod.installed ? 'is-ok' : 'is-missing'}`,
      mod.bundled
        ? ds('bundled')
        : ds(mod.installed ? 'installed' : 'notInstalled')
    )
  );
  info.append(heading);
  if (purpose) {
    info.append(el('p', 'mt-0.5 truncate text-sm text-gray-400', purpose));
  }
  const meta = el(
    'p',
    'mt-1 truncate text-xs text-gray-500',
    [
      `${ds('version')} ${mod.version}`,
      formatSize(mod.size),
      `${ds('source')}: ${mod.source}`,
    ]
      .filter(Boolean)
      .join(' · ')
  );
  // The source line is long; the full text stays reachable on hover.
  meta.title = mod.source;
  info.append(meta);

  row.append(icon, info);

  if (!mod.installed) {
    row.append(
      button(ds('download'), 'ph-download-simple', 'is-primary', () => {
        void download([mod.name]);
      })
    );
  } else if (!mod.bundled) {
    row.append(
      button(ds('remove'), 'ph-trash', 'is-quiet', async () => {
        await getBridge()?.removeModule(mod.name);
        await render();
      })
    );
  }

  return row;
}

async function render(): Promise<void> {
  const list = document.getElementById('desktop-modules-list');
  const actions = document.getElementById('desktop-modules-actions');
  const bridge = getBridge();
  if (!list || !actions || !bridge) return;

  const modules = await bridge.getModulesStatus();
  list.textContent = '';
  modules.forEach((mod) => list.append(moduleRow(mod)));

  actions.textContent = '';
  const missing = modules.filter((m) => !m.installed).map((m) => m.name);
  if (missing.length > 0) {
    actions.append(
      button(ds('downloadAll'), 'ph-download-simple', 'is-outline', () => {
        void download(missing);
      })
    );
  } else {
    const done = el('p', 'desktop-badge is-ok');
    done.append(el('i', 'ph ph-check-circle'), ` ${ds('allInstalled')}`);
    actions.append(done);
  }
}

function initThemeOptions(): void {
  const options = document.querySelectorAll<HTMLElement>('[data-theme-option]');

  const sync = () => {
    options.forEach((option) => {
      option.setAttribute(
        'aria-checked',
        String(option.dataset.themeOption === currentTheme())
      );
    });
  };

  options.forEach((option) => {
    option.addEventListener('click', () => {
      setTheme(option.dataset.themeOption === 'light' ? 'light' : 'dark');
    });
  });

  // Also follows the quick toggle in the status bar.
  document.addEventListener(THEME_EVENT, sync);
  sync();
}

function initLanguageSelect(): void {
  const select = document.getElementById(
    'desktop-language-select'
  ) as HTMLSelectElement | null;
  if (!select) return;

  orderedLanguages.forEach((lang) => {
    const option = document.createElement('option');
    option.value = lang;
    option.textContent = languageNames[lang];
    select.append(option);
  });
  select.value = getLanguageFromUrl();
  select.addEventListener('change', () => {
    changeLanguage(select.value as (typeof orderedLanguages)[number]);
  });
}

applyDesktopStrings();
initThemeOptions();
initLanguageSelect();
void render();
