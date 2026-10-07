import { getLanguageFromUrl } from '../i18n/i18n.js';

// Strings that only exist in the desktop shell. Vietnamese is the app's
// default language; every other language falls back to English.
const STRINGS = {
  vi: {
    searchPlaceholder: 'Tìm công cụ…',
    noResults: 'Không tìm thấy công cụ nào',
    favorites: 'Yêu thích',
    recent: 'Gần đây',
    allTools: 'Nhóm công cụ',
    settings: 'Cài đặt',
    addFavorite: 'Thêm vào Yêu thích',
    removeFavorite: 'Bỏ khỏi Yêu thích',
    modulesStatus: 'Bộ xử lý: {n}/{m} đã có',
    openFileTitle: 'Bạn muốn làm gì với tệp này?',
    openFileCurrent: 'Dùng với công cụ đang mở',
    openFileFailed: 'Không đọc được tệp',
    viewerUseTool: 'Dùng công cụ khác',
    printTitle: 'In tài liệu',
    printPrinter: 'Máy in',
    printDefault: 'mặc định',
    printNoPrinters: 'Không tìm thấy máy in nào trên máy này.',
    printCopies: 'Số bản',
    printPages: 'Trang',
    printPagesAll: 'Tất cả ({n} trang)',
    printPagesCurrent: 'Trang hiện tại (trang {n})',
    printPagesCustom: 'Tùy chọn',
    printPagesHint: 'Ví dụ: 1-3, 5',
    printPagesInvalid: 'Khoảng trang không hợp lệ. Tài liệu có {n} trang.',
    printPaper: 'Khổ giấy',
    printOrientation: 'Hướng giấy',
    printAuto: 'Tự động',
    printPortrait: 'Dọc',
    printLandscape: 'Ngang',
    printScale: 'Tỉ lệ',
    printFit: 'Vừa khổ giấy',
    printActual: 'Kích thước thật (100%)',
    printSides: 'In hai mặt',
    printSimplex: 'Một mặt',
    printLongEdge: 'Hai mặt, lật theo cạnh dài',
    printShortEdge: 'Hai mặt, lật theo cạnh ngắn',
    printColor: 'Màu sắc',
    printColorOn: 'Màu',
    printColorOff: 'Đen trắng',
    printDo: 'In',
    printSystem: 'Dùng hộp thoại in của hệ thống',
    printPreparing: 'Đang chuẩn bị trang {n}/{m}…',
    printSending: 'Đang gửi tới máy in…',
    printFailed: 'Không in được',
    printSheet: 'Trang {n} / {m}',
    printPrev: 'Trang trước',
    printNext: 'Trang sau',
    cancel: 'Hủy',
    settingsTitle: 'Cài đặt',
    themeTitle: 'Giao diện',
    themeLight: 'Sáng',
    themeDark: 'Tối',
    themeToggle: 'Đổi giao diện sáng/tối',
    language: 'Ngôn ngữ',
    modulesTitle: 'Bộ xử lý',
    modulesIntro:
      'Các bộ xử lý nặng được tải về khi cần và lưu trên máy để dùng offline. Bạn có thể tải trước hoặc xóa để giải phóng ổ đĩa.',
    bundled: 'Có sẵn trong bộ cài',
    installed: 'Đã tải',
    notInstalled: 'Chưa tải',
    download: 'Tải về',
    downloadAll: 'Tải tất cả',
    remove: 'Xóa',
    version: 'Phiên bản',
    source: 'Nguồn',
    allInstalled: 'Tất cả bộ xử lý đã sẵn sàng dùng offline.',
  },
  en: {
    searchPlaceholder: 'Search tools…',
    noResults: 'No tools found',
    favorites: 'Favorites',
    recent: 'Recent',
    allTools: 'Tool groups',
    settings: 'Settings',
    addFavorite: 'Add to Favorites',
    removeFavorite: 'Remove from Favorites',
    modulesStatus: 'Engines: {n}/{m} available',
    openFileTitle: 'What do you want to do with this file?',
    openFileCurrent: 'Use with the current tool',
    openFileFailed: 'Could not read the file',
    viewerUseTool: 'Use another tool',
    printTitle: 'Print',
    printPrinter: 'Printer',
    printDefault: 'default',
    printNoPrinters: 'No printers were found on this computer.',
    printCopies: 'Copies',
    printPages: 'Pages',
    printPagesAll: 'All ({n} pages)',
    printPagesCurrent: 'Current page (page {n})',
    printPagesCustom: 'Custom',
    printPagesHint: 'e.g. 1-3, 5',
    printPagesInvalid: 'Invalid page range. The document has {n} pages.',
    printPaper: 'Paper size',
    printOrientation: 'Orientation',
    printAuto: 'Automatic',
    printPortrait: 'Portrait',
    printLandscape: 'Landscape',
    printScale: 'Scale',
    printFit: 'Fit to paper',
    printActual: 'Actual size (100%)',
    printSides: 'Two-sided',
    printSimplex: 'One side',
    printLongEdge: 'Both sides, flip on long edge',
    printShortEdge: 'Both sides, flip on short edge',
    printColor: 'Color',
    printColorOn: 'Color',
    printColorOff: 'Black and white',
    printDo: 'Print',
    printSystem: 'Use the system print dialog',
    printPreparing: 'Preparing page {n}/{m}…',
    printSending: 'Sending to the printer…',
    printFailed: 'Printing failed',
    printSheet: 'Page {n} / {m}',
    printPrev: 'Previous page',
    printNext: 'Next page',
    cancel: 'Cancel',
    settingsTitle: 'Settings',
    themeTitle: 'Appearance',
    themeLight: 'Light',
    themeDark: 'Dark',
    themeToggle: 'Switch between light and dark',
    language: 'Language',
    modulesTitle: 'Engines',
    modulesIntro:
      'Heavy engines are downloaded on demand and kept on this computer for offline use. You can download them ahead of time or remove them to free up disk space.',
    bundled: 'Included in the installer',
    installed: 'Downloaded',
    notInstalled: 'Not downloaded',
    download: 'Download',
    downloadAll: 'Download all',
    remove: 'Remove',
    version: 'Version',
    source: 'Source',
    allInstalled: 'All engines are ready for offline use.',
  },
} as const;

export type DesktopStringKey = keyof (typeof STRINGS)['en'];

export function desktopLang(): 'vi' | 'en' {
  return getLanguageFromUrl() === 'vi' ? 'vi' : 'en';
}

export function ds(
  key: DesktopStringKey,
  vars: Record<string, string | number> = {}
): string {
  let text: string = STRINGS[desktopLang()][key];
  for (const [name, value] of Object.entries(vars)) {
    text = text.replace(`{${name}}`, String(value));
  }
  return text;
}

/** Fill in elements marked with data-desktop-i18n[-title|-placeholder]="<key>". */
export function applyDesktopStrings(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-desktop-i18n]').forEach((el) => {
    const key = el.dataset.desktopI18n as DesktopStringKey;
    if (key in STRINGS.en) el.textContent = ds(key);
  });
  root
    .querySelectorAll<HTMLElement>('[data-desktop-i18n-title]')
    .forEach((el) => {
      const key = el.dataset.desktopI18nTitle as DesktopStringKey;
      if (key in STRINGS.en) el.title = ds(key);
    });
  root
    .querySelectorAll<HTMLInputElement>('[data-desktop-i18n-placeholder]')
    .forEach((el) => {
      const key = el.dataset.desktopI18nPlaceholder as DesktopStringKey;
      if (key in STRINGS.en) el.placeholder = ds(key);
    });
}
