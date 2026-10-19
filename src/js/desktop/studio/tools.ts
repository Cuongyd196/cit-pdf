/**
 * Tools Studio applies to the document on screen. Each takes the current
 * bytes and the values of its fields and returns the new bytes; the drawer
 * builds the fields and keeps the history.
 */
import { degrees } from 'pdf-lib';
import { loadPdfDocument } from '../../utils/load-pdf-document.js';
import {
  addPageNumbers,
  addTextWatermark,
  parseDeletePages,
  parsePageRange,
  splitPdf,
  type PageNumberFormat,
  type PageNumberPosition,
} from '../../utils/pdf-operations.js';
import { flattenAnnotations } from '../../utils/flatten-annotations.js';
import { hexToRgb } from '../../utils/helpers.js';
import { ds, type DesktopStringKey } from '../strings.js';

export type StudioField =
  | {
      kind: 'select';
      id: string;
      label: DesktopStringKey;
      options: Array<[string, DesktopStringKey]>;
      value: string;
    }
  | {
      kind: 'number';
      id: string;
      label: DesktopStringKey;
      min: number;
      max: number;
      value: number;
      /** Shown only while another field has this value. */
      shownWhen?: { field: string; value: string };
    }
  | {
      kind: 'text';
      id: string;
      label: DesktopStringKey;
      placeholder?: DesktopStringKey;
      value: string;
    }
  | { kind: 'color'; id: string; label: DesktopStringKey; value: string }
  | { kind: 'file'; id: string; label: DesktopStringKey; value: '' };

export type StudioValues = Record<string, string>;

export interface StudioContext {
  /** Files picked in the tool's file fields, by field id. */
  files: Record<string, File | undefined>;
  /** Name of the document the tool works on. */
  fileName: string;
}

export interface StudioResult {
  bytes: Uint8Array;
  /** The step's name in the history. */
  label: string;
  /** For a tool that makes a new file: the name offered for it. */
  fileName?: string;
  /** Something the user should know about the result, shown with it. */
  note?: string;
}

export interface StudioTool {
  id: string;
  icon: string;
  name: DesktopStringKey;
  hint: DesktopStringKey;
  fields: StudioField[];
  /**
   * Opens the full editor (EmbedPDF) over the document instead of a form;
   * such a tool has no apply of its own.
   */
  opensEditor?: true;
  /**
   * Makes a new file from the document (saved through "Save as") instead of
   * changing it; the document and its history stay as they are.
   */
  makesFile?: true;
  apply(
    bytes: Uint8Array,
    values: StudioValues,
    context: StudioContext
  ): Promise<StudioResult>;
}

/** Characters Windows does not allow in a file name. */
const fileNameSafe = (text: string) => text.replace(/[\\/:*?"<>|]/g, '-');

/** A problem with what the user asked for, shown beside the fields. */
export class StudioInputError extends Error {}

async function save(doc: Awaited<ReturnType<typeof loadPdfDocument>>) {
  return new Uint8Array(await doc.save());
}

function optionLabel(field: StudioField, value: string): string {
  if (field.kind !== 'select') return value;
  const option = field.options.find(([v]) => v === value);
  return option ? ds(option[1]) : value;
}

const rotateAngle: StudioField = {
  kind: 'select',
  id: 'angle',
  label: 'studioAngle',
  options: [
    ['90', 'studioRotateRight'],
    ['180', 'studioRotate180'],
    ['270', 'studioRotateLeft'],
  ],
  value: '90',
};

const pageNumberPosition: StudioField = {
  kind: 'select',
  id: 'position',
  label: 'studioPosition',
  options: [
    ['bottom-center', 'studioBottomCenter'],
    ['bottom-right', 'studioBottomRight'],
    ['bottom-left', 'studioBottomLeft'],
    ['top-center', 'studioTopCenter'],
    ['top-right', 'studioTopRight'],
    ['top-left', 'studioTopLeft'],
  ],
  value: 'bottom-center',
};

export const STUDIO_TOOLS: StudioTool[] = [
  {
    id: 'edit',
    icon: 'pencil-simple-line',
    name: 'studioEdit',
    hint: 'studioEditHint',
    fields: [],
    opensEditor: true,
    apply() {
      return Promise.reject(new Error('Edits are made in the editor'));
    },
  },
  {
    id: 'rotate',
    icon: 'arrow-clockwise',
    name: 'studioRotate',
    hint: 'studioRotateHint',
    fields: [
      rotateAngle,
      {
        kind: 'text',
        id: 'pages',
        label: 'studioPages',
        placeholder: 'studioPagesAllHint',
        value: '',
      },
    ],
    async apply(bytes, values) {
      const doc = await loadPdfDocument(bytes);
      const total = doc.getPageCount();
      const pages = values.pages.trim()
        ? parsePageRange(values.pages, total)
        : doc.getPageIndices();
      if (pages.length === 0) {
        throw new StudioInputError(ds('studioPagesInvalid', { n: total }));
      }
      const angle = Number(values.angle);
      for (const index of pages) {
        const page = doc.getPage(index);
        page.setRotation(degrees((page.getRotation().angle + angle) % 360));
      }
      const where = values.pages.trim()
        ? ds('studioOnPages', { pages: values.pages.trim() })
        : '';
      return {
        bytes: await save(doc),
        label: `${ds('studioRotate')} ${optionLabel(rotateAngle, values.angle)}${where}`,
      };
    },
  },
  {
    id: 'delete-pages',
    icon: 'trash',
    name: 'studioDelete',
    hint: 'studioDeleteHint',
    fields: [
      {
        kind: 'text',
        id: 'pages',
        label: 'studioPages',
        placeholder: 'studioPagesHint',
        value: '',
      },
    ],
    async apply(bytes, values) {
      const doc = await loadPdfDocument(bytes);
      const total = doc.getPageCount();
      const pages = values.pages.trim()
        ? parseDeletePages(values.pages, total)
        : new Set<number>();
      if (pages.size === 0) {
        throw new StudioInputError(ds('studioPagesInvalid', { n: total }));
      }
      if (pages.size >= total) {
        throw new StudioInputError(ds('studioDeleteAll'));
      }
      for (const page of [...pages].sort((a, b) => b - a)) {
        doc.removePage(page - 1);
      }
      return {
        bytes: await save(doc),
        label: `${ds('studioDelete')} ${values.pages.trim()}`,
      };
    },
  },
  {
    id: 'insert',
    icon: 'file-plus',
    name: 'studioInsert',
    hint: 'studioInsertHint',
    fields: [
      { kind: 'file', id: 'source', label: 'studioInsertFile', value: '' },
      {
        kind: 'select',
        id: 'where',
        label: 'studioInsertWhere',
        options: [
          ['end', 'studioInsertEnd'],
          ['start', 'studioInsertStart'],
          ['after', 'studioInsertAfter'],
        ],
        value: 'end',
      },
      {
        kind: 'number',
        id: 'after',
        label: 'studioInsertAfterPage',
        min: 1,
        max: 9999,
        value: 1,
        shownWhen: { field: 'where', value: 'after' },
      },
    ],
    async apply(bytes, values, { files }) {
      const source = files.source;
      if (!source) throw new StudioInputError(ds('studioInsertNoFile'));
      let added: Awaited<ReturnType<typeof loadPdfDocument>>;
      try {
        added = await loadPdfDocument(
          new Uint8Array(await source.arrayBuffer())
        );
      } catch {
        throw new StudioInputError(
          ds('studioInsertBad', { name: source.name })
        );
      }
      const doc = await loadPdfDocument(bytes);
      const total = doc.getPageCount();
      const at =
        values.where === 'start'
          ? 0
          : values.where === 'after'
            ? Math.min(Math.max(Number(values.after) || 0, 0), total)
            : total;
      const pages = await doc.copyPages(added, added.getPageIndices());
      pages.forEach((page, i) => doc.insertPage(at + i, page));
      const where =
        values.where === 'start'
          ? ds('studioInsertStart')
          : values.where === 'after'
            ? ds('studioInsertAfterN', { n: at })
            : ds('studioInsertEnd');
      return {
        bytes: await save(doc),
        label: ds('studioInsertStep', {
          name: source.name,
          n: pages.length,
          where: where.toLowerCase(),
        }),
      };
    },
  },
  {
    id: 'extract',
    icon: 'export',
    name: 'studioExtract',
    hint: 'studioExtractHint',
    makesFile: true,
    fields: [
      {
        kind: 'text',
        id: 'pages',
        label: 'studioPages',
        placeholder: 'studioPagesHint',
        value: '',
      },
    ],
    async apply(bytes, values, { fileName }) {
      const doc = await loadPdfDocument(bytes);
      const total = doc.getPageCount();
      const asked = values.pages.trim();
      const pages = asked ? parsePageRange(asked, total) : [];
      if (pages.length === 0) {
        throw new StudioInputError(ds('studioPagesInvalid', { n: total }));
      }
      const stem = fileName.replace(/\.pdf$/i, '');
      return {
        bytes: await splitPdf(bytes, pages),
        label: ds('studioExtract'),
        fileName: `${ds('studioExtractName', {
          name: stem,
          pages: fileNameSafe(asked.replace(/\s+/g, '')),
        })}.pdf`,
      };
    },
  },
  {
    id: 'watermark',
    icon: 'drop-half',
    name: 'studioWatermark',
    hint: 'studioWatermarkHint',
    fields: [
      {
        kind: 'text',
        id: 'text',
        label: 'studioWatermarkText',
        placeholder: 'studioWatermarkPlaceholder',
        value: '',
      },
      {
        kind: 'select',
        id: 'layout',
        label: 'studioLayout',
        options: [
          ['center', 'studioLayoutCenter'],
          ['tile', 'studioLayoutTile'],
        ],
        value: 'center',
      },
      {
        kind: 'number',
        id: 'size',
        label: 'studioFontSize',
        min: 8,
        max: 200,
        value: 48,
      },
      {
        kind: 'number',
        id: 'opacity',
        label: 'studioOpacity',
        min: 5,
        max: 100,
        value: 30,
      },
      {
        kind: 'number',
        id: 'angle',
        label: 'studioWatermarkAngle',
        min: -90,
        max: 90,
        value: 45,
      },
      { kind: 'color', id: 'color', label: 'studioColor', value: '#6b7280' },
    ],
    async apply(bytes, values) {
      const text = values.text.trim();
      if (!text) throw new StudioInputError(ds('studioWatermarkEmpty'));
      const result = await addTextWatermark(bytes, {
        text,
        fontSize: Number(values.size) || 48,
        color: hexToRgb(values.color),
        opacity: (Number(values.opacity) || 30) / 100,
        angle: Number(values.angle) || 0,
        tile: values.layout === 'tile',
      });
      return { bytes: result, label: `${ds('studioWatermark')} "${text}"` };
    },
  },
  {
    id: 'page-numbers',
    icon: 'list-numbers',
    name: 'studioPageNumbers',
    hint: 'studioPageNumbersHint',
    fields: [
      pageNumberPosition,
      {
        kind: 'select',
        id: 'format',
        label: 'studioNumberFormat',
        options: [
          ['simple', 'studioFormatSimple'],
          ['page_x_of_y', 'studioFormatOfTotal'],
        ],
        value: 'simple',
      },
      {
        kind: 'number',
        id: 'size',
        label: 'studioFontSize',
        min: 6,
        max: 48,
        value: 11,
      },
      { kind: 'color', id: 'color', label: 'studioColor', value: '#000000' },
    ],
    async apply(bytes, values) {
      const result = await addPageNumbers(bytes, {
        position: values.position as PageNumberPosition,
        format: values.format as PageNumberFormat,
        fontSize: Number(values.size) || 11,
        color: hexToRgb(values.color),
      });
      return {
        bytes: result,
        label: `${ds('studioPageNumbers')} (${optionLabel(pageNumberPosition, values.position).toLowerCase()})`,
      };
    },
  },
  {
    id: 'flatten',
    icon: 'stack-simple',
    name: 'studioFlatten',
    hint: 'studioFlattenHint',
    fields: [],
    async apply(bytes) {
      const doc = await loadPdfDocument(bytes);
      try {
        doc.getForm().flatten();
      } catch (e) {
        console.warn('[Studio] Could not flatten the form:', e);
      }
      try {
        flattenAnnotations(doc);
      } catch (e) {
        console.warn('[Studio] Could not flatten annotations:', e);
      }
      return { bytes: await save(doc), label: ds('studioFlatten') };
    },
  },
  {
    id: 'compress',
    icon: 'arrows-in',
    name: 'studioCompress',
    hint: 'studioCompressHint',
    fields: [
      {
        kind: 'select',
        id: 'level',
        label: 'studioCompressLevel',
        options: [
          ['light', 'studioCompressLight'],
          ['balanced', 'studioCompressBalanced'],
          ['aggressive', 'studioCompressStrong'],
        ],
        value: 'balanced',
      },
      {
        kind: 'select',
        id: 'target',
        label: 'studioCompressTarget',
        options: [
          ['', 'studioTargetNone'],
          ['1', 'studioTarget1'],
          ['2', 'studioTarget2'],
          ['5', 'studioTarget5'],
          ['10', 'studioTarget10'],
          ['custom', 'studioTargetCustom'],
        ],
        value: '',
      },
      {
        kind: 'number',
        id: 'targetCustom',
        label: 'studioTargetCustomMb',
        min: 1,
        max: 500,
        value: 3,
        shownWhen: { field: 'target', value: 'custom' },
      },
      {
        kind: 'select',
        id: 'color',
        label: 'studioCompressColor',
        options: [
          ['keep', 'studioColorKeep'],
          ['gray', 'studioColorGray'],
        ],
        value: 'keep',
      },
      {
        kind: 'select',
        id: 'images',
        label: 'studioCompressText',
        options: [
          ['allow', 'studioTextAllow'],
          ['keep', 'studioTextKeep'],
        ],
        value: 'allow',
      },
    ],
    async apply(bytes, values) {
      const megabytes =
        values.target === 'custom'
          ? parseFloat(values.targetCustom)
          : parseFloat(values.target);
      // MB as file portals count them: 1 MB = 1,000,000 bytes.
      const targetBytes =
        megabytes > 0 ? Math.floor(megabytes * 1000 * 1000) : null;
      const limit = targetBytes === null ? '' : `${megabytes} MB`;
      if (targetBytes !== null && bytes.length <= targetBytes) {
        throw new StudioInputError(ds('studioCompressAlready', { limit }));
      }

      // PyMuPDF is a module downloaded on first use; load it only here.
      const [{ compressToTarget, formatMegabytes }, { getPDFDocument }] =
        await Promise.all([
          import('../../utils/compress-to-target.js'),
          import('../../utils/helpers.js'),
          import('../../utils/setup-pdf-worker.js'),
        ]);
      const result = await compressToTarget(
        new Blob([bytes as BlobPart], { type: 'application/pdf' }),
        {
          level: values.level,
          targetBytes,
          grayscale: values.color === 'gray',
          keepText: values.images === 'keep',
          loadPdf: () => getPDFDocument({ data: bytes.slice() }).promise,
        }
      );
      if (!result) throw new StudioInputError(ds('studioFailed'));
      const out = new Uint8Array(await result.blob.arrayBuffer());
      // Not worth a step when it saves next to nothing.
      if (out.length >= bytes.length * 0.97) {
        throw new StudioInputError(ds('studioCompressNoGain'));
      }
      const notes = [
        result.reachedTarget
          ? ''
          : ds('studioCompressOver', {
              limit,
              size: formatMegabytes(out.length),
            }),
        result.rasterized ? ds('studioCompressImages') : '',
      ].filter(Boolean);
      return {
        bytes: out,
        // In the same units as the limit, so "→ 2.07 MB" compares with it.
        label: `${ds('studioCompress')} ${formatMegabytes(bytes.length)} → ${formatMegabytes(out.length)}`,
        note: notes.join(' ') || undefined,
      };
    },
  },
];
