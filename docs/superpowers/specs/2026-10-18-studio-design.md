# Studio: tools applied in place in the PDF viewer (desktop)

Approved 2026-10-18.

## Goal

Open a PDF once in the viewer, apply several tools to it in place, undo
freely, save once (overwrite the original or save as), the way PDFCraft's
Studio works. Desktop only.

## User-facing behaviour

- Quick-action row of the viewer gets a **Công cụ** button that opens a
  drawer on the right (~320px) beside the document.
- Drawer: search box, list of tools; picking one shows its options and
  **Áp dụng**. The result replaces the document in the current tab; the
  viewer keeps the page and zoom.
- First wave: Xoay (all pages or a range, 90/180/270), Xoá trang (range),
  Đóng dấu nước chữ (text, size, opacity, angle, colour, centre or tiled),
  Đánh số trang (position, "1" or "1 / 10", size), Làm phẳng (forms and
  annotations), Nén (level; refused when it would not shrink the file).
- Per tab history: Undo/Redo (Ctrl+Z, Ctrl+Y / Ctrl+Shift+Z, and buttons),
  list of steps in the drawer, "Khôi phục bản gốc" (itself an undoable step).
  At most 20 steps are kept; older ones fold into the base.
- A tab with unsaved changes shows "•" before its name.
- Save cluster on the quick-action row once a tab has edits: Undo, Redo,
  **Lưu thành…** (Ctrl+Shift+S), **Lưu** (Ctrl+S). Lưu overwrites the
  original through the step-1 mechanism (first-time confirmation,
  `setSaveTarget`, temp file + rename). A tab whose file has no path saves
  through the Save dialog. The tab turns clean when the save is reported.
- Closing a tab with unsaved changes asks first. Leaving the page (another
  tool, home, closing the window) goes through `beforeunload`, which the
  main process already turns into the "Thay đổi chưa lưu" dialog.

## Structure

- `src/js/logic/viewer-document.ts` — the contract between the viewer page
  and Studio: the viewer provides `active()`, `show(file, bytes)`,
  `setDirty(file, dirty)`; Studio provides a close guard. Keyboard events
  from viewer frames are re-dispatched as `cit:viewer-keydown`.
- `src/js/logic/view-pdf-page.ts` — implements it: per-tab current blob,
  reload through `PDFViewerApplication.open` keeping page/zoom, dirty marker,
  async close guard, `beforeunload` while dirty (blob URLs revoked on
  `pagehide` instead).
- `src/js/desktop/studio/history.ts` — pure undo history (unit tested).
- `src/js/desktop/studio/tools.ts` — tool registry: fields and
  `apply(bytes, values) → bytes`, built on `utils/pdf-operations.ts`,
  `utils/flatten-annotations.ts`, `utils/compress.ts`.
- `src/js/desktop/studio/studio.ts` — drawer UI, save cluster, shortcuts,
  save flow; started by `shell.ts` on the viewer page with the active tab's
  `OpenedFile`.
- Strings in `src/js/desktop/strings.ts` (vi/en).

## Testing

- Vitest for `history.ts`.
- E2E in the scratchpad harness: open a PDF in the viewer, apply rotate,
  watermark, delete pages, undo once, save (overwrite), then check the file
  on disk (page count, rotation, watermark present); unsaved-close prompt.

## Out of scope (next waves)

Image watermark, header/footer, crop, protect, OCR; "open the full tool"
link per tool; carrying unsaved edits into another tool page.
