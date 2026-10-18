/**
 * A button that drops down a list of choices. The list is placed on the
 * page (fixed), not inside the button's row, so a row that scrolls
 * sideways does not clip it.
 */

export interface MenuChoice {
  /** Phosphor icon class, e.g. "ph-scissors". */
  icon: string;
  label: string;
  /** A link (moving to a tool page) or an action. */
  href?: string;
  run?: () => void;
  /** Kept for finding the choice later (tests, styling). */
  id?: string;
  /** Leaves this page: marked with an arrow at the end. */
  external?: boolean;
  /** Tooltip, when the label alone is short. */
  title?: string;
}

/** A title over the choices that follow it. */
export interface MenuHeading {
  heading: string;
}

/** A line between groups of choices. */
export interface MenuSeparator {
  separator: true;
}

export type MenuEntry = MenuChoice | MenuHeading | MenuSeparator;

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

let closeOpen: (() => void) | null = null;

export function menuButton(options: {
  icon: string;
  label: string;
  title?: string;
  className: string;
  choices: () => MenuEntry[];
}): HTMLButtonElement {
  const button = make('button', options.className);
  button.type = 'button';
  button.title = options.title ?? options.label;
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  button.append(
    make('i', `ph ${options.icon}`),
    make('span', '', options.label),
    make('i', 'ph ph-caret-down desktop-menu-caret')
  );

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    const wasOpen = button.getAttribute('aria-expanded') === 'true';
    closeOpen?.();
    if (wasOpen) return;

    const list = make('div', 'desktop-menu');
    list.setAttribute('role', 'menu');
    for (const choice of options.choices()) {
      if ('heading' in choice) {
        list.append(make('div', 'desktop-menu-heading', choice.heading));
        continue;
      }
      if ('separator' in choice) {
        list.append(make('div', 'desktop-menu-separator'));
        continue;
      }
      const item = choice.href
        ? Object.assign(make('a', 'desktop-menu-item'), { href: choice.href })
        : Object.assign(make('button', 'desktop-menu-item'), {
            type: 'button',
          });
      item.setAttribute('role', 'menuitem');
      if (choice.id) item.dataset.choice = choice.id;
      if (choice.title) item.title = choice.title;
      item.append(
        make('i', `ph ${choice.icon}`),
        make('span', '', choice.label)
      );
      if (choice.external) {
        item.append(make('i', 'ph ph-arrow-up-right desktop-menu-external'));
      }
      item.addEventListener('click', () => {
        close();
        choice.run?.();
      });
      list.append(item);
    }
    document.body.append(list);
    const box = button.getBoundingClientRect();
    const left = Math.min(box.left, window.innerWidth - list.offsetWidth - 8);
    list.style.left = `${Math.max(8, left)}px`;
    list.style.top = `${box.bottom + 4}px`;
    button.setAttribute('aria-expanded', 'true');
    list.querySelector<HTMLElement>('.desktop-menu-item')?.focus();

    const onDown = (e: Event) => {
      // A press on the button itself is left to its click, which closes.
      const target = e.target as Node;
      if (!list.contains(target) && !button.contains(target)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        button.focus();
      }
    };
    function close(): void {
      list.remove();
      button.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', close);
      if (closeOpen === close) closeOpen = null;
    }
    closeOpen = close;
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', close);
  });
  return button;
}
