import { createLanguageSwitcher } from '../i18n/language-switcher.js';

// Handle simple mode adjustments for tool pages
if (__SIMPLE_MODE__) {
  const sectionsToHide = [
    'How It Works',
    'Related PDF Tools',
    'Related Tools',
    'Frequently Asked Questions',
  ];

  const hideMarketingSections = () => {
    document.querySelectorAll('section').forEach((section) => {
      const h2 = section.querySelector('h2');
      const heading = h2?.textContent?.trim() || '';
      const hasMarketing =
        Boolean(
          section.querySelector(
            '.faq-list, .faq-d, [data-i18n*="faq"], [data-i18n*="relatedTools"], [data-i18n*="howItWorks"]'
          )
        ) ||
        (h2 &&
          (h2.hasAttribute('data-i18n') &&
            /^(faq|relatedTools|howItWorks)\./i.test(
              h2.getAttribute('data-i18n') || ''
            ))) ||
        sectionsToHide.some((text) => heading.includes(text));

      if (hasMarketing) {
        (section as HTMLElement).style.display = 'none';
      }
    });
  };

  hideMarketingSections();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hideMarketingSections);
  }

  const langContainer = document.getElementById('simple-mode-lang-switcher');
  if (langContainer) {
    const switcher = createLanguageSwitcher();
    const dropdown = switcher.querySelector('div[role="menu"]');
    if (dropdown) {
      dropdown.classList.remove('mt-2');
      dropdown.classList.add('bottom-full', 'mb-2');
    }
    langContainer.appendChild(switcher);
  }
}
