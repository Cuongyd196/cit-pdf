/**
 * A message with a few buttons; resolves with the id of the one clicked,
 * or null when closed with Escape. For decisions an OK box cannot ask.
 */
export interface DialogChoice {
  id: string;
  label: string;
  primary?: boolean;
}

export function showChoiceDialog(options: {
  title: string;
  message: string;
  choices: DialogChoice[];
}): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className =
      'choice-dialog fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    const box = document.createElement('div');
    box.className =
      'w-full max-w-md rounded-lg border border-gray-700 bg-gray-800 p-6 shadow-xl';
    const title = document.createElement('h3');
    title.className = 'mb-2 text-lg font-bold text-white';
    title.textContent = options.title;
    const message = document.createElement('p');
    message.className =
      'mb-6 text-sm leading-relaxed whitespace-pre-line text-gray-300';
    message.textContent = options.message;

    const buttons = document.createElement('div');
    buttons.className = 'flex flex-col gap-2';
    const close = (id: string | null) => {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(id);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close(null);
    };
    for (const choice of options.choices) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.choice = choice.id;
      button.className = choice.primary
        ? 'rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700'
        : 'rounded-lg border border-gray-600 px-4 py-2.5 text-sm font-medium text-gray-200 hover:bg-gray-700';
      button.textContent = choice.label;
      button.addEventListener('click', () => close(choice.id));
      buttons.append(button);
    }

    box.append(title, message, buttons);
    overlay.append(box);
    document.body.append(overlay);
    document.addEventListener('keydown', onKey, true);
    buttons.querySelector<HTMLButtonElement>('button')?.focus();
  });
}
