document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('faq-modal');
  const openBtn = document.getElementById('faq-open-btn');
  const closeBtn = document.getElementById('faq-close-btn');
  if (!modal || !openBtn) return;

  if (__SIMPLE_MODE__) {
    openBtn.classList.add('hidden');
    modal.remove();
    return;
  }

  const setOpen = (open: boolean) => {
    modal.classList.toggle('hidden', !open);
    modal.setAttribute('aria-hidden', open ? 'false' : 'true');
    openBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) closeBtn?.focus();
    else openBtn.focus();
  };

  openBtn.addEventListener('click', () => setOpen(true));
  closeBtn?.addEventListener('click', () => setOpen(false));
  modal.addEventListener('click', (event) => {
    if (event.target === modal) setOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.classList.contains('hidden')) {
      setOpen(false);
    }
  });
});
