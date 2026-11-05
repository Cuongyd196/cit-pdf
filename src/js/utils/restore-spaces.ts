// The edit engine drops some word spaces when it reads a page. Word, for one,
// writes each Vietnamese letter it can't encode in its WinAnsi subset as its
// own text object in a second font, and the space that follows as another
// object; the engine loses that space, so "dữ liệu" reads "dữliệu" and stays
// joined once the paragraph is re-laid out. pdf.js reads the same page with
// the spaces. This puts back, in the engine's paragraph model, the spaces
// pdf.js saw between two letters the model has side by side.

export interface SpaceReference {
  /** The page's letters in reading order, whitespace left out. */
  chars: string[];
  /** Whether a space came before chars[i] (on the same line). */
  spaceBefore: boolean[];
  /** chars joined, to find where a paragraph starts. */
  joined: string;
}

interface ModelRun {
  text: string;
}
interface ModelLine {
  off: number;
}
interface ModelParagraph {
  runs?: ModelRun[];
  lines?: ModelLine[];
  /** Set when the model was changed and no longer matches the page's objects. */
  adjusted?: boolean;
}

const WHITE = /\s/;

/** Builds the reference from pdf.js text: item strings, with a newline after an item that ends a line. */
export function buildSpaceReference(pageText: string): SpaceReference {
  const chars: string[] = [];
  const spaceBefore: boolean[] = [];
  let pendingSpace = false;
  for (const ch of pageText.normalize('NFC')) {
    if (ch === '\n' || ch === '\r') {
      pendingSpace = false;
      continue;
    }
    if (WHITE.test(ch)) {
      pendingSpace = true;
      continue;
    }
    chars.push(ch);
    spaceBefore.push(pendingSpace && chars.length > 1);
    pendingSpace = false;
  }
  return { chars, spaceBefore, joined: chars.join('') };
}

const ANCHOR = 16;

/**
 * Inserts the missing spaces into each paragraph's runs, in place, and shifts
 * its line offsets to match. A paragraph is matched by its first letters and
 * then walked letter by letter; the walk stops at the first letter that
 * differs from the reference, so text the two read differently is left alone.
 */
export function restoreDroppedSpaces<P extends ModelParagraph>(
  paragraphs: P[],
  ref: SpaceReference | null
): P[] {
  if (!ref || !ref.chars.length) return paragraphs;
  for (const p of paragraphs) {
    if (p.runs?.length) restoreParagraph(p, ref);
  }
  return paragraphs;
}

function restoreParagraph(p: ModelParagraph, ref: SpaceReference): void {
  const runs = p.runs!;
  const flat: string[] = [];
  for (const r of runs) for (const ch of r.text || '') flat.push(ch);
  // Letters of the paragraph with their index in flat.
  const letters: { ch: string; at: number }[] = [];
  flat.forEach((ch, at) => {
    if (!WHITE.test(ch)) letters.push({ ch, at });
  });
  if (letters.length < 2) return;
  const anchor = letters
    .slice(0, ANCHOR)
    .map((l) => l.ch)
    .join('');
  const start = ref.joined.indexOf(anchor);
  if (start < 0) return;
  // The reference is indexed by code point; joined is a UTF-16 string.
  const r0 = [...ref.joined.slice(0, start)].length;
  const lineStarts = new Set((p.lines || []).map((l) => l.off));
  const inserts: number[] = [];
  for (let k = 1; k < letters.length; k++) {
    const r = r0 + k;
    if (r >= ref.chars.length || ref.chars[r] !== letters[k].ch) break;
    if (!ref.spaceBefore[r]) continue;
    const prev = letters[k - 1].at;
    const at = letters[k].at;
    // Already apart (a space, a tab, a line break) or wrapped onto a new line.
    if (at - prev !== 1 || lineStarts.has(at)) continue;
    inserts.push(at);
  }
  if (!inserts.length) return;
  p.adjusted = true;
  // Insert from the end so earlier indexes stay valid. A space goes at the
  // start of the run that holds the next letter, which is where Word put it.
  for (let i = inserts.length - 1; i >= 0; i--) {
    const at = inserts[i];
    let base = 0;
    for (const r of runs) {
      const len = [...(r.text || '')].length;
      if (at < base + len) {
        const cps = [...r.text];
        cps.splice(at - base, 0, ' ');
        r.text = cps.join('');
        break;
      }
      base += len;
    }
    for (const l of p.lines || []) if (l.off > at) l.off++;
  }
}
