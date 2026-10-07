const revealTargets = document.querySelectorAll<HTMLElement>('.lp-reveal');
const reducedMotion = window.matchMedia(
  '(prefers-reduced-motion: reduce)'
).matches;

if (
  revealTargets.length > 0 &&
  !reducedMotion &&
  'IntersectionObserver' in window
) {
  document.documentElement.classList.add('lp-js');
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.1 }
  );
  revealTargets.forEach((target) => observer.observe(target));
}
