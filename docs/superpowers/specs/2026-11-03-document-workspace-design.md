# Document workspace: ribbon tabs and page grid (desktop)

Approved 2026-11-04. Built on branch feat/workspace: Split and Excel/JPG/PowerPoint stay on their own pages for now (linked from the ribbon with the document); PDF to Word and to text run in place.

## Goal

Work on the open document the way PdfCraft does: open a PDF once, pick a
group of tools from tabs at the top, select pages with the mouse, apply,
undo, save once. Builds on Studio (2026-10-18); desktop only.

## User-facing behaviour

### Ribbon

The flat quick-action row above the document becomes a row of tabs, each
with its own toolbar under it:

| Tab                | Toolbar                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------- |
| **Đọc**            | the viewer as today (no extra buttons)                                                   |
| **Trang**          | page grid (below): rotate left/right, delete, extract, split here, insert PDF, blank page |
| **Sửa**            | Chỉnh sửa & ghi chú (EmbedPDF), đóng dấu nước, đánh số trang, làm phẳng, ký              |
| **Chuyển đổi**     | PDF → Word, Excel, ảnh (JPG/PNG), văn bản                                                |
| **Tối ưu & bảo mật** | nén, đặt mật khẩu, gỡ mật khẩu                                                          |
| **Tất cả công cụ** | opens a left panel listing every tool by group, with search                              |

- The right end of the row keeps today's cluster: page count, Undo, Redo,
  folder, print, Lưu thành…, Lưu. It is the same on every tab.
- The chosen tab is remembered. Opening a document starts on **Đọc**.
- Tools with options keep using the Studio drawer on the right; tools
  without options (rotate, delete selected pages…) apply on click.

### Page grid (tab Trang)

- The document area shows page thumbnails in a grid instead of the reader.
- Click selects a page, Ctrl+click adds or removes one, Shift+click selects
  a run, Ctrl+A selects all, Esc clears. The bar shows "3 trang đã chọn".
- Drag pages to reorder them, the selection moving together.
- Each action (rotate, delete, move, insert, blank page) is one Studio
  history step, undoable with Ctrl+Z. Extract and split make new files next
  to the original, as Studio's Extract does today.
- Thumbnail size slider; double-click a page opens it in **Đọc**.

### Chuyển đổi on the open document

PDF → Word/Excel/JPG/text run on the tab's current bytes (unsaved edits
included). The result is offered with Save as in the original's folder,
named after it (`<name>.docx`). Progress and the "may take a few minutes"
note show in the drawer, not as a full-screen loader.

### Tất cả công cụ panel

Left panel like PdfCraft's "All tools": groups, search, favourites first.
A tool that works in place selects its tab and opens it; any other tool
opens its own page with the document handed over (today's "Mở bằng…").
It replaces the "Công cụ khác" menu.

## Structure

- `src/js/desktop/studio/ribbon.ts` — tabs and per-tab toolbars, built
  from a list of `{ tab, toolId | action }`. Replaces the row setup in
  `shell.ts` `initViewerActions` and `ROW_TOOLS` / `MORE_TOOLS` in
  `studio.ts`.
- `src/js/desktop/studio/page-grid.ts` — the grid: renders thumbnails with
  pdf.js from the history's current bytes, selection model, drag reorder.
  Selection logic in a pure module (`page-selection.ts`), unit tested.
- `src/js/desktop/studio/tools.ts` — page tools take an optional list of
  selected pages instead of a typed range. New: reorder, blank page, split
  at page, convert (Word/Excel/JPG/text via existing utils and PyMuPDF).
- `src/js/desktop/studio/all-tools.ts` — the left panel, reusing the
  home page's tool list and search.
- Strings in `src/js/desktop/strings.ts` (vi/en).

## Testing

- Vitest: page selection (click, Ctrl, Shift, select all, after delete and
  reorder), reorder/blank/split tool functions.
- E2E (scratchpad harness over CDP): open a 10-page PDF, Trang tab, select
  2 pages, rotate, delete one, drag one to the front, undo once, save, then
  check the file on disk; Chuyển đổi → Word on an edited document.

## Waves

1. Ribbon with today's tools regrouped, Tất cả công cụ panel.
2. Page grid with selection, rotate/delete/reorder/extract.
3. Chuyển đổi tab on the open document; protect/unlock in place.

## Out of scope

Editing text inside the grid; web build; carrying a selection between tabs.
