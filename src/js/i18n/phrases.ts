/**
 * Phrase-level translation for text that never went through i18n keys.
 *
 * Most tool pages and their scripts carry English strings written straight
 * into the markup or the code. Rather than rewrite hundreds of files, a
 * language can ship `locales/<lang>/phrases.json`: a map from the English
 * source text to its translation. This module swaps matching text in the
 * page, including text the tools insert later (alerts, progress messages).
 *
 * Keys may contain numbered placeholders for runtime values, for example
 * "Loading page {0}..." or "Page {0} of {1}".
 */

interface PhrasePattern {
  regex: RegExp;
  translation: string;
  literalLength: number;
}

const SKIPPED_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'TEXTAREA',
  'CODE',
  'PRE',
  'KBD',
  'NOSCRIPT',
]);
const TRANSLATED_ATTRIBUTES = ['placeholder', 'title', 'aria-label'];
const PLACEHOLDER = /\{(\d+)\}/g;

let exact = new Map<string, string>();
let patterns: PhrasePattern[] = [];

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function setPhrases(dictionary: Record<string, string>): void {
  exact = new Map();
  patterns = [];

  for (const [source, translation] of Object.entries(dictionary)) {
    const key = normalize(source);
    if (!key || !translation) continue;

    if (!PLACEHOLDER.test(key)) {
      exact.set(key, translation);
      continue;
    }
    PLACEHOLDER.lastIndex = 0;

    const literal = key.replace(PLACEHOLDER, '');
    // A key that is almost all placeholder would match nearly anything.
    if (literal.replace(/[^A-Za-z]/g, '').length < 3) continue;

    const body = key
      .split(PLACEHOLDER)
      // split() with a capture group alternates literal, index, literal...
      // A value may be empty, e.g. the plural "s" in "page{1}".
      .map((part, i) => (i % 2 === 0 ? escapeRegex(part) : '(.*?)'))
      .join('');
    patterns.push({
      regex: new RegExp(`^${body}$`),
      translation,
      literalLength: literal.length,
    });
  }

  // Most specific first, so "Page {0} of {1}" wins over "Page {0}".
  patterns.sort((a, b) => b.literalLength - a.literalLength);
}

/**
 * Translate one piece of text, keeping its leading and trailing whitespace.
 * Returns null when there is nothing to change.
 */
export function translatePhrase(text: string): string | null {
  const core = normalize(text);
  if (!core) return null;

  let result = exact.get(core);
  if (result === undefined) {
    for (const pattern of patterns) {
      const match = pattern.regex.exec(core);
      if (!match) continue;
      result = pattern.translation.replace(
        PLACEHOLDER,
        (_whole, index: string) => {
          // A value can itself be a known phrase, e.g. an optional sentence.
          const value = match[Number(index) + 1] ?? '';
          return exact.get(value.trim()) ?? value;
        }
      );
      break;
    }
  }
  if (result === undefined || result === core) return null;

  const lead = /^\s*/.exec(text)?.[0] ?? '';
  const trail = /\s*$/.exec(text)?.[0] ?? '';
  return lead + result + trail;
}

function isSkipped(element: Element | null): boolean {
  for (let el = element; el; el = el.parentElement) {
    if (SKIPPED_TAGS.has(el.tagName)) return true;
    if (el.hasAttribute('data-no-translate')) return true;
    const editable = el.getAttribute('contenteditable');
    if (editable !== null && editable !== 'false') return true;
  }
  return false;
}

function translateAttributes(element: Element): void {
  for (const name of TRANSLATED_ATTRIBUTES) {
    const value = element.getAttribute(name);
    if (!value) continue;
    const translated = translatePhrase(value);
    if (translated !== null) element.setAttribute(name, translated);
  }
}

function translateTextNode(node: Text): void {
  if (!node.nodeValue || isSkipped(node.parentElement)) return;
  const translated = translatePhrase(node.nodeValue);
  if (translated !== null) node.nodeValue = translated;
}

/** Translate everything under (and including) the given node. */
export function translateTree(root: Node): void {
  if (exact.size === 0 && patterns.length === 0) return;

  if (root.nodeType === Node.TEXT_NODE) {
    translateTextNode(root as Text);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return;

  const element = root as Element;
  if (isSkipped(element)) return;

  translateAttributes(element);
  element
    .querySelectorAll(TRANSLATED_ATTRIBUTES.map((a) => `[${a}]`).join(','))
    .forEach((el) => {
      if (!isSkipped(el)) translateAttributes(el);
    });

  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
  textNodes.forEach(translateTextNode);
}

let observer: MutationObserver | null = null;

/**
 * Translate the page now and keep translating whatever is added or changed
 * later. Writing a translation triggers the observer again, but translated
 * text no longer matches a source phrase, so it settles immediately.
 */
function watch(): void {
  if (observer || !document.body) return;
  translateTree(document.body);

  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') {
        translateTree(mutation.target);
      } else if (mutation.type === 'attributes') {
        const target = mutation.target as Element;
        if (!isSkipped(target)) translateAttributes(target);
      } else {
        mutation.addedNodes.forEach((node) => translateTree(node));
      }
    }
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: TRANSLATED_ATTRIBUTES,
  });
}

/**
 * Load the phrase dictionary for a language, if it ships one, and start
 * translating. English is the source language and needs none.
 */
export async function initPhrases(lang: string): Promise<void> {
  if (lang === 'en' || typeof document === 'undefined') return;
  try {
    const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
    const response = await fetch(`${base}locales/${lang}/phrases.json`);
    if (!response.ok) return;
    setPhrases((await response.json()) as Record<string, string>);
  } catch (e) {
    console.warn('[i18n] Could not load phrase translations:', e);
    return;
  }

  if (document.body) watch();
  else document.addEventListener('DOMContentLoaded', watch, { once: true });
}
