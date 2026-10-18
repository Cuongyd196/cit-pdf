/**
 * The EmbedPDF editor (annotations, shapes, redaction, text), shared by the
 * PDF editor page and the desktop Studio: starting it in an element, and
 * exporting the edited document with its text boxes made readable
 * everywhere (flattened into page text, or drawn with an embedded font).
 */
import type { EmbedPdfContainer } from 'bentopdf-viewer';
import type {
  AnnotationPluginLite,
  FreeTextSystemFontAnnotation,
} from '@/types';
import { getEditorDisabledCategories } from '../utils/disabled-tools.js';
import { editorFontFallback } from '../config/editor-fonts.js';
import { editorLocale, localizeEditorLabels } from '../config/editor-locale.js';
import { getLanguageFromUrl } from '../i18n/i18n.js';
import { needsFontEmbedding } from '../utils/freetext-script.js';

const embedPdfWasmUrl = new URL(
  'bentopdf-pdfium/editcore.wasm',
  import.meta.url
).href;

const FREETEXT_SUBTYPE = 3;

type Registry = Awaited<EmbedPdfContainer['registry']>;

export interface EmbedEditorOptions {
  /** Name offered when the editor's own export is used. */
  fileName: string;
  tabBar: 'always' | 'multiple' | 'never';
  maxDocuments?: number;
}

/** Starts the editor in `target` (emptied first). */
export async function startEmbedEditor(
  target: HTMLElement,
  options: EmbedEditorOptions
): Promise<{ viewer: EmbedPdfContainer; registry: Registry }> {
  target.textContent = '';
  const { default: EmbedPDF } = await import('bentopdf-viewer');
  const viewer = EmbedPDF.init({
    disabledCategories: getEditorDisabledCategories(),
    type: 'container',
    target,
    worker: true,
    wasmUrl: embedPdfWasmUrl,
    fontFallback: editorFontFallback,
    // The viewer has its own translations; make it follow the app.
    i18n: editorLocale(getLanguageFromUrl()),
    export: { defaultFileName: options.fileName },
    documentManager: { maxDocuments: options.maxDocuments ?? 10 },
    tabBar: options.tabBar,
  });
  if (!viewer) throw new Error('The PDF editor did not start');
  localizeEditorLabels(target, getLanguageFromUrl());
  return { viewer, registry: await viewer.registry };
}

function collectAllFreeTexts(
  annotationPlugin: AnnotationPluginLite | null
): FreeTextSystemFontAnnotation[] {
  if (!annotationPlugin) return [];
  try {
    const state = annotationPlugin.getState();
    const out: FreeTextSystemFontAnnotation[] = [];
    for (const tracked of Object.values(state.byUid)) {
      const obj = tracked.object;
      if (obj.type !== FREETEXT_SUBTYPE) continue;
      if (obj.intent === 'FreeTextCallout') continue;
      if (!obj.id || obj.pageIndex == null || !obj.rect) continue;
      out.push({
        id: obj.id,
        pageIndex: obj.pageIndex,
        contents: obj.contents ?? '',
        fontSize: obj.fontSize ?? 12,
        fontColor: obj.fontColor ?? '#000000',
        textAlign: obj.textAlign ?? 0,
        verticalAlign: obj.verticalAlign ?? 0,
        opacity: obj.opacity ?? 1,
        backgroundColor: obj.color ?? obj.backgroundColor,
        rect: obj.rect,
        fontPostScriptName: obj.fontPostScriptName ?? '',
        rotation: obj.rotation ?? 0,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** The active document, edited, as bytes. */
export async function exportEmbedEditorPdf(
  registry: Registry
): Promise<Uint8Array> {
  const exportPlugin = registry.getPlugin('export').provides() as unknown as {
    saveAsCopy(): { toPromise(): Promise<ArrayBuffer> };
  };
  const arrayBuffer = await exportPlugin.saveAsCopy().toPromise();
  let outBytes: Uint8Array = new Uint8Array(arrayBuffer);
  let annotationPlugin: AnnotationPluginLite | null;
  try {
    annotationPlugin = registry
      .getPlugin('annotation')
      .provides() as unknown as AnnotationPluginLite;
  } catch {
    annotationPlugin = null;
  }
  let pending = collectAllFreeTexts(annotationPlugin);
  if (pending.length > 0) {
    try {
      const { flattenFreeTextToPageText } =
        await import('../utils/freetext-flatten.js');
      const res = await flattenFreeTextToPageText(outBytes, pending);
      if (res.flattened > 0) {
        outBytes = res.bytes;
        pending = [];
      }
    } catch (err) {
      console.error('Flatten pass failed:', err);
    }
  }
  const customFontAnnots = pending.filter(
    (a) => a.fontPostScriptName.trim() !== '' || needsFontEmbedding(a.contents)
  );
  if (customFontAnnots.length > 0) {
    try {
      const { embedFreeTextSystemFonts } =
        await import('../utils/freetext-font-embed.js');
      outBytes = await embedFreeTextSystemFonts(outBytes, customFontAnnots);
    } catch (err) {
      console.error('Font embed pass failed:', err);
    }
  }
  return outBytes;
}
