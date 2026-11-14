import { startingPages } from './providers/extracted-data';
import settingsCss from './tempo-settings.css?inline';

import type { SettingsItem } from './tempo-settings-menu';

interface GuideEntry extends HTMLElement {
  data?: { navigationEndpoint?: { browseEndpoint?: { browseId?: string } } };
}

export function mountTempoSettings() {
  const czech = /^cs\b/.test(window.mainConfig.get('options.language') ?? document.documentElement.lang);
  const copy = czech
    ? {
        title: 'Nastavení',
        close: 'Zavřít',
        back: 'Zpět',
        search: 'Hledat plugin',
        empty: 'Žádný plugin neodpovídá hledání.',
        loadError: 'Nastavení se nepodařilo načíst.',
        version: (v: string) => `Tempo Desktop · Verze ${v}`,
      }
    : {
        title: 'Settings',
        close: 'Close',
        back: 'Back',
        search: 'Find a plugin',
        empty: 'No plugins match your search.',
        loadError: 'Settings could not be loaded.',
        version: (v: string) => `Tempo Desktop · Version ${v}`,
      };

  const style = new CSSStyleSheet();
  style.replaceSync(settingsCss);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, style];

  function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  }

  function control(className: string, text = '') {
    const button = element('button', className, text);
    button.type = 'button';
    return button;
  }

  const dialog = element('dialog', 'tempo-settings');
  dialog.id = 'tempo-settings';
  dialog.setAttribute('aria-labelledby', 'tempo-settings-title');
  const header = element('header', 'tempo-settings-header');
  const heading = element('div', 'tempo-settings-heading');
  const title = element('h1', '', copy.title);
  title.id = 'tempo-settings-title';
  const versionBadge = element('span', 'tempo-settings-version');
  versionBadge.hidden = true;
  heading.append(title, versionBadge);
  const close = control('tempo-settings-close', '×');
  close.setAttribute('aria-label', copy.close);
  close.title = copy.close;
  close.autofocus = true;
  header.append(heading, close);

  const grid = element('div', 'tempo-settings-grid');
  const categories = element('nav', 'tempo-settings-categories');
  categories.setAttribute('aria-label', copy.title);
  const main = element('div', 'tempo-settings-main');
  const sectionHeader = element('div', 'tempo-settings-section-header');
  const back = control('tempo-settings-back', '‹ ' + copy.back);
  const sectionTitle = element('h2');
  sectionTitle.tabIndex = -1;
  const search = element('input', 'tempo-settings-search');
  search.type = 'search';
  search.placeholder = copy.search;
  search.setAttribute('aria-label', copy.search);
  sectionHeader.append(back, sectionTitle, search);
  const list = element('div', 'tempo-settings-list');
  const feedback = element('div', 'tempo-settings-feedback');
  feedback.setAttribute('role', 'status');
  main.append(sectionHeader, list, feedback);
  grid.append(categories, main);
  dialog.append(header, grid);
  document.body.append(dialog);

  let menu: SettingsItem[] = [];
  let category = 0;
  let path: string[] = [];
  let busy = false;
  let request = 0;
  let activeTrigger: HTMLButtonElement | undefined;
  let transition: Animation | undefined;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function placeTriggers() {
    for (const section of document.querySelectorAll('ytmusic-guide-section-renderer[is-primary]')) {
      const items = section.querySelector(':scope > #items');
      if (!items) continue;
      const entries = items.querySelectorAll<GuideEntry>(':scope > ytmusic-guide-entry-renderer[is-primary]');
      const library = [...entries].find(
        (entry) => entry.data?.navigationEndpoint?.browseEndpoint?.browseId === startingPages.Library,
      ) ?? entries.item(entries.length - 1);
      if (!library) continue;

      const existing = items.querySelector('.tempo-settings-trigger');
      if (existing) {
        if (library.nextElementSibling !== existing) library.after(existing);
        continue;
      }

      const button = control('tempo-settings-trigger');
      button.title = copy.title + ' · Ctrl+,';
      button.setAttribute('aria-haspopup', 'dialog');
      button.setAttribute('aria-controls', dialog.id);
      button.setAttribute('aria-expanded', String(dialog.open));
      const gear = document.createElement('yt-icon');
      gear.setAttribute('icon', 'yt-icons:settings');
      gear.setAttribute('aria-hidden', 'true');
      button.append(gear, element('span', '', copy.title));
      button.addEventListener('click', () => openSettings(button));
      library.after(button);
    }
  }

  function isVisible(button: HTMLButtonElement) {
    if (!button.checkVisibility({ visibilityProperty: true })) return false;
    const bounds = button.getBoundingClientRect();
    return bounds.left >= 0 && bounds.right <= window.innerWidth &&
      bounds.top >= 0 && bounds.bottom <= window.innerHeight;
  }

  function getTriggers() {
    return [...document.querySelectorAll<HTMLButtonElement>('.tempo-settings-trigger')];
  }

  function animateSection(direction: number) {
    transition?.cancel();
    if (reducedMotion.matches) return;

    transition = main.animate([
      { opacity: 0, transform: `translateX(${direction * 10}px)` },
      { opacity: 1, transform: 'translateX(0)' },
    ], { duration: 190, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' });
  }

  function selectCategory(index: number) {
    const direction = Math.sign(index - category) || (path.length ? -1 : 0);
    category = index;
    path = [];
    search.value = '';
    list.scrollTop = 0;
    renderList();
    for (const [current, button] of [...categories.children].entries()) {
      button.toggleAttribute('data-selected', current === index);
      if (current === index) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    }
    if (direction) animateSection(direction);
  }

  function renderList() {
    const focused = document.activeElement;
    const focusedCommand = focused instanceof HTMLElement && list.contains(focused)
      ? focused.dataset.commandLabel : undefined;
    let items = menu[category]?.children ?? [];
    let label = menu[category]?.label ?? '';
    let depth = 0;
    for (const step of path) {
      const group = items.find((item) => item.label === step && item.type === 'submenu');
      if (!group) break;
      depth++;
      items = group.children;
      label = group.label;
    }
    path = path.slice(0, depth);
    back.hidden = depth === 0;
    search.hidden = category !== 0 || depth !== 0 || menu.length === 0;
    sectionTitle.textContent = label;

    const query = search.hidden ? '' : search.value.trim().toLocaleLowerCase();
    const rows: HTMLElement[] = [];
    for (const item of items) {
      if (item.type === 'separator') {
        if (!query && rows.length && rows.at(-1)?.tagName !== 'HR') rows.push(element('hr'));
        continue;
      }
      if (query && ![item.label, item.description].some((part) => part?.toLocaleLowerCase().includes(query))) continue;
      const row = control('tempo-settings-row');
      row.dataset.commandLabel = item.label;
      row.disabled = !item.enabled;
      if (item.icon) {
        const icon = element('img', 'tempo-settings-item-icon');
        icon.src = item.icon;
        icon.alt = '';
        row.append(icon);
      }
      const description = element('span', 'tempo-settings-row-text');
      description.append(element('span', 'tempo-settings-row-label', item.label));
      if (item.description) description.append(element('span', 'tempo-settings-description', item.description));
      row.append(description);

      if (item.type === 'submenu') {
        const chevron = element('span', 'tempo-settings-chevron', '›');
        chevron.setAttribute('aria-hidden', 'true');
        row.append(chevron);
        row.addEventListener('click', () => {
          path.push(item.label);
          list.scrollTop = 0;
          renderList();
          sectionTitle.focus({ preventScroll: true });
          animateSection(1);
        });
      } else {
        if (item.type === 'radio' || item.type === 'checkbox') {
          row.setAttribute('aria-pressed', String(item.checked));
          const indicator = element('span', item.type === 'radio' ? 'tempo-settings-radio' : 'tempo-settings-switch');
          indicator.setAttribute('aria-hidden', 'true');
          row.append(indicator);
        }
        row.addEventListener('click', () => {
          runCommand(item);
        });
      }
      rows.push(row);
    }
    if (rows.at(-1)?.tagName === 'HR') rows.pop();
    if (!rows.length && query) rows.push(element('p', 'tempo-settings-empty', copy.empty));
    list.replaceChildren(...rows);
    if (focusedCommand) rows.find((row) => row.dataset.commandLabel === focusedCommand)?.focus({ preventScroll: true });
  }

  async function refresh() {
    const id = ++request;
    try {
      const next = await window.ipcRenderer.invoke('tempo:settings-menu') as SettingsItem[];
      if (id !== request || !dialog.open) return;
      menu = next;
      if (!menu[category]) category = 0;
      const buttons = menu.map((item, index) => {
        const button = control('tempo-settings-category', item.label);
        button.toggleAttribute('data-selected', index === category);
        if (index === category) button.setAttribute('aria-current', 'true');
        button.addEventListener('click', () => selectCategory(index));
        return button;
      });
      const focusedIndex = [...categories.children].indexOf(document.activeElement!);
      categories.replaceChildren(...buttons);
      buttons[focusedIndex]?.focus({ preventScroll: true });
      feedback.textContent = menu.length ? '' : copy.loadError;
      renderList();
    } catch {
      if (id === request) feedback.textContent = copy.loadError;
    }
  }

  async function runCommand(item: SettingsItem) {
    if (busy) return;
    busy = true;
    try {
      await window.ipcRenderer.invoke('tempo:settings-command', item.commandId);
      if (dialog.open) await refresh();
    } catch {
      feedback.textContent = copy.loadError;
    } finally {
      busy = false;
    }
  }

  async function loadVersion() {
    if (!versionBadge.hidden) return;
    try {
      const version = (await window.ipcRenderer.invoke('tempo:app-version')) as string;
      if (version) {
        versionBadge.textContent = copy.version(version);
        versionBadge.hidden = false;
      }
    } catch {
      // Ignore transient startup IPC error; retried when opening settings.
    }
  }

  function openSettings(trigger = getTriggers().find(isVisible)) {
    if (dialog.open) return;
    dialog.showModal();
    activeTrigger = trigger;
    for (const button of getTriggers()) button.setAttribute('aria-expanded', 'true');
    loadVersion();
    refresh();
  }

  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    transition?.cancel();
    for (const button of getTriggers()) button.setAttribute('aria-expanded', 'false');
    const target = activeTrigger && isVisible(activeTrigger) ? activeTrigger : getTriggers().find(isVisible);
    target?.focus({ preventScroll: true });
    activeTrigger = undefined;
  });
  back.addEventListener('click', () => {
    path.pop();
    list.scrollTop = 0;
    renderList();
    sectionTitle.focus({ preventScroll: true });
    animateSection(-1);
  });
  search.addEventListener('input', renderList);
  window.addEventListener('keydown', (event) => {
    if (dialog.open) {
      if (event.key === 'Escape') {
        event.preventDefault();
        dialog.close();
      }
      if (event.key === 'Escape' || !(event.ctrlKey || event.metaKey)) {
        event.stopPropagation();
      }
    }
    if (event.key === ',' && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      if (dialog.open) dialog.close();
      else openSettings();
    }
  }, true);
  window.ipcRenderer.on('refresh-in-app-menu', () => {
    if (dialog.open) refresh();
  });
  loadVersion();
  placeTriggers();
  new MutationObserver(placeTriggers).observe(document.body, { childList: true, subtree: true });
}
