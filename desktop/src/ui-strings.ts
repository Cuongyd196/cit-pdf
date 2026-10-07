/**
 * Text shown by the main process itself: the menu bar and native dialogs.
 * The web bundle has its own translations; this covers what it cannot reach.
 * Vietnamese is the default; every other app language falls back to English.
 */

const vi = {
  menuFile: 'Tệp',
  openPdf: 'Mở tệp PDF…',
  closeWindow: 'Đóng cửa sổ',
  quit: 'Thoát',
  menuEdit: 'Chỉnh sửa',
  undo: 'Hoàn tác',
  redo: 'Làm lại',
  cut: 'Cắt',
  copy: 'Sao chép',
  paste: 'Dán',
  delete: 'Xóa',
  selectAll: 'Chọn tất cả',
  menuView: 'Hiển thị',
  reload: 'Tải lại',
  forceReload: 'Tải lại hoàn toàn',
  devTools: 'Công cụ nhà phát triển',
  resetZoom: 'Kích thước thật',
  zoomIn: 'Phóng to',
  zoomOut: 'Thu nhỏ',
  fullscreen: 'Toàn màn hình',
  menuWindow: 'Cửa sổ',
  minimize: 'Thu nhỏ cửa sổ',
  zoomWindow: 'Phóng to cửa sổ',
  bringAllToFront: 'Đưa tất cả lên trước',
  menuHelp: 'Trợ giúp',
  about: 'Giới thiệu {app}',
  sourceCode: 'Mã nguồn {app} (GitHub)',
  cancel: 'Hủy',
  remove: 'Xóa',
  removeModuleTitle: 'Xóa bộ xử lý',
  removeModuleMessage: 'Xóa bộ xử lý "{name}" khỏi máy?',
  removeModuleDetail: 'Bạn có thể tải lại bất cứ lúc nào khi cần dùng.',
  download: 'Tải về',
  downloadModulesTitle: 'Cần tải thêm thành phần xử lý',
  downloadModulesMessage:
    'Tính năng này cần tải thêm module xử lý từ nguồn chính thống:',
  downloadModulesDetail:
    'Sau khi tải xong, ứng dụng sẽ hoạt động offline hoàn toàn.',
};

export type UiStrings = typeof vi;

const en: UiStrings = {
  menuFile: 'File',
  openPdf: 'Open PDF…',
  closeWindow: 'Close Window',
  quit: 'Exit',
  menuEdit: 'Edit',
  undo: 'Undo',
  redo: 'Redo',
  cut: 'Cut',
  copy: 'Copy',
  paste: 'Paste',
  delete: 'Delete',
  selectAll: 'Select All',
  menuView: 'View',
  reload: 'Reload',
  forceReload: 'Force Reload',
  devTools: 'Developer Tools',
  resetZoom: 'Actual Size',
  zoomIn: 'Zoom In',
  zoomOut: 'Zoom Out',
  fullscreen: 'Full Screen',
  menuWindow: 'Window',
  minimize: 'Minimize',
  zoomWindow: 'Zoom',
  bringAllToFront: 'Bring All to Front',
  menuHelp: 'Help',
  about: 'About {app}',
  sourceCode: '{app} Source Code (GitHub)',
  cancel: 'Cancel',
  remove: 'Remove',
  removeModuleTitle: 'Remove engine',
  removeModuleMessage: 'Remove the "{name}" engine from this computer?',
  removeModuleDetail: 'You can download it again whenever you need it.',
  download: 'Download',
  downloadModulesTitle: 'Additional components required',
  downloadModulesMessage:
    'This feature needs processing modules downloaded from their official source:',
  downloadModulesDetail:
    'Once downloaded, the application works fully offline.',
};

let language = 'vi';

export function getUiLanguage(): string {
  return language;
}

/** Returns true when the language actually changed. */
export function setUiLanguage(next: string): boolean {
  if (next.length > 5 || !/^[a-zA-Z-]+$/.test(next)) return false;
  if (next === language) return false;
  language = next;
  return true;
}

export function ui(): UiStrings {
  return language === 'vi' ? vi : en;
}

export function fill(text: string, values: Record<string, string>): string {
  return text.replace(
    /\{(\w+)\}/g,
    (whole, key: string) => values[key] ?? whole
  );
}
