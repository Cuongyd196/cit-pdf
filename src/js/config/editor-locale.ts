/**
 * Language of the PDF editor (edit-pdf). The embedded viewer has its own
 * translations and does not follow the app: it ships eight languages and no
 * Vietnamese, so that one is supplied here. Keys mirror the viewer's English
 * locale; `{name}` placeholders are filled in by the viewer.
 */

const vietnamese = {
  code: 'vi',
  name: 'Tiếng Việt',
  translations: {
    search: {
      placeholder: 'Tìm kiếm',
      caseSensitive: 'Phân biệt hoa thường',
      wholeWord: 'Khớp cả từ',
      resultsFound: 'Tìm thấy {count} kết quả',
      page: 'Trang {page}',
    },
    zoom: {
      in: 'Phóng to',
      out: 'Thu nhỏ',
      fitWidth: 'Vừa chiều rộng',
      fitPage: 'Vừa trang',
      marquee: 'Phóng to vùng chọn',
      menu: 'Trình đơn thu phóng',
      level: 'Mức thu phóng ({level}%)',
      dragTip: 'Kéo để chọn vùng cần phóng to',
    },
    pan: {
      toggle: 'Bật/tắt chế độ kéo trang',
    },
    pointer: {
      toggle: 'Bật/tắt chế độ con trỏ',
    },
    capture: {
      screenshot: 'Chụp màn hình',
      dragTip: 'Kéo để chọn vùng cần chụp',
      title: 'Xem trước ảnh chụp',
      download: 'Tải xuống',
      cancel: 'Hủy',
    },
    document: {
      menu: 'Trình đơn tài liệu',
      open: 'Mở',
      close: 'Đóng',
      print: 'In',
      protect: 'Bảo mật',
      export: 'Xuất',
      fullscreen: 'Toàn màn hình',
      loading: 'Đang tải tài liệu...',
    },
    emptyState: {
      title: 'Chưa mở tài liệu nào',
      description: 'Mở một tài liệu PDF để bắt đầu.',
      descriptionMulti: 'Bạn có thể xem nhiều tài liệu bằng các tab.',
      openButton: 'Mở tài liệu',
      supportedFormats: 'Định dạng hỗ trợ: PDF',
    },
    passwordPrompt: {
      title: 'Cần mật khẩu',
      required:
        'Tài liệu này được bảo vệ bằng mật khẩu. Hãy nhập mật khẩu để mở.',
      incorrect: 'Mật khẩu bạn nhập không đúng. Hãy thử lại.',
      incorrectWarning: 'Mật khẩu không đúng. Hãy kiểm tra rồi thử lại.',
      label: 'Mật khẩu',
      placeholder: 'Nhập mật khẩu tài liệu',
      open: 'Mở',
      opening: 'Đang mở...',
      cancel: 'Hủy',
      close: 'Đóng',
    },
    documentError: {
      title: 'Lỗi khi tải tài liệu',
      unknown: 'Đã xảy ra lỗi không xác định',
      errorCode: 'Mã lỗi: {code}',
      close: 'Đóng tài liệu',
    },
    panel: {
      sidebar: 'Thanh bên',
      search: 'Tìm kiếm',
      comment: 'Bình luận',
      thumbnails: 'Ảnh thu nhỏ',
      outline: 'Mục lục',
      annotationStyle: 'Kiểu ghi chú',
      redaction: 'Bảng che nội dung',
    },
    menu: {
      viewControls: 'Điều khiển hiển thị',
      zoomControls: 'Điều khiển thu phóng',
      moreOptions: 'Tùy chọn khác',
    },
    outline: {
      title: 'Mục lục',
      loading: 'Đang tải mục lục...',
      noOutline: 'Không có mục lục',
      noBookmarks: 'Tài liệu này không có bookmark',
    },
    page: {
      settings: 'Thiết lập trang',
      single: 'Một trang',
      twoOdd: 'Hai trang (bắt đầu trang lẻ)',
      twoEven: 'Hai trang (bắt đầu trang chẵn)',
      vertical: 'Dọc',
      horizontal: 'Ngang',
      spreadMode: 'Kiểu dàn trang',
      scrollLayout: 'Hướng cuộn',
      rotation: 'Xoay trang',
      next: 'Trang sau',
      previous: 'Trang trước',
    },
    rotate: {
      clockwise: 'Xoay theo chiều kim đồng hồ',
      counterClockwise: 'Xoay ngược chiều kim đồng hồ',
    },
    selection: {
      copy: 'Sao chép vùng chọn',
    },
    mode: {
      view: 'Xem',
      annotate: 'Ghi chú',
      shapes: 'Hình vẽ',
      redact: 'Che nội dung',
    },
    annotation: {
      text: 'Văn bản',
      highlight: 'Tô sáng',
      strikeout: 'Gạch ngang',
      underline: 'Gạch chân',
      squiggly: 'Gạch lượn sóng',
      rectangle: 'Hình chữ nhật',
      circle: 'Hình tròn',
      line: 'Đường thẳng',
      arrow: 'Mũi tên',
      polygon: 'Đa giác',
      polyline: 'Đường gấp khúc',
      ink: 'Bút vẽ',
      inkHighlighter: 'Bút tô sáng',
      stamp: 'Con dấu',
      caret: 'Dấu chèn',
      insertText: 'Chèn văn bản',
      replaceText: 'Thay văn bản',
      freeText: 'Hộp văn bản',
      square: 'Hình vuông',
      style: 'Kiểu ghi chú',
      styles: 'Kiểu của {type}',
      defaults: 'Mặc định của {type}',
      color: 'Màu',
      opacity: 'Độ mờ',
      blendMode: 'Chế độ hòa trộn',
      strokeWidth: 'Độ dày nét',
      strokeColor: 'Màu nét',
      borderStyle: 'Kiểu viền',
      fillColor: 'Màu nền',
      fontSize: 'Cỡ chữ',
      fontFamily: 'Phông chữ',
      callout: 'Chú thích có mũi tên',
      searchFonts: 'Tìm phông chữ',
      standardFonts: 'Phông chuẩn',
      systemFonts: 'Phông của máy',
      loadingFonts: 'Đang tải phông chữ…',
      textAlign: 'Căn chữ',
      verticalAlign: 'Căn dọc',
      lineEnding: 'Đầu mút đường',
      lineStart: 'Đầu đường',
      lineEnd: 'Cuối đường',
      font: 'Phông chữ',
      fontColor: 'Màu chữ',
      backgroundColor: 'Màu nền',
      noStyles: 'Ghi chú này không có kiểu để chỉnh.',
      noStylesStamp: 'Con dấu không có kiểu để chỉnh.',
      selectAnnotation: 'Chọn một ghi chú để xem kiểu',
      deleteSelected: 'Xóa ghi chú đang chọn',
      deleteAllSelected: 'Xóa mục đã chọn',
      multiSelect: 'Đã chọn {count} ghi chú',
      group: 'Nhóm',
      ungroup: 'Bỏ nhóm',
      moreTools: 'Công cụ khác',
      addLink: 'Thêm liên kết',
      removeLink: 'Gỡ liên kết',
      gotoLink: 'Đi tới liên kết',
      comment: 'Bình luận',
      redact: 'Che nội dung',
      overlayText: 'Chữ phủ lên',
      overlayTextPlaceholder: 'ví dụ: ĐÃ CHE',
      rotation: 'Góc xoay',
    },
    redaction: {
      redact: 'Che nội dung',
      area: 'Che một vùng',
      text: 'Che văn bản',
      apply: 'Áp dụng che',
      applyAll: 'Áp dụng tất cả',
      clearAll: 'Xóa tất cả',
      deleteSelected: 'Xóa vùng che đang chọn',
      commitSelected: 'Áp dụng vùng che đang chọn',
      emptyState: 'Không có vùng che nào đang chờ',
      panel: {
        title: 'Vùng che',
        itemCount: '{count} vùng che đang chờ',
        itemCountPlural: '{count} vùng che đang chờ',
        clearAll: 'Xóa tất cả',
        redactAll: 'Che tất cả',
      },
    },
    history: {
      undo: 'Hoàn tác',
      redo: 'Làm lại',
    },
    comments: {
      commentingAs: 'Bình luận với tên',
      author: 'Tác giả',
      page: 'Trang {page}',
      commentCount: '{count} bình luận',
      commentCountPlural: '{count} bình luận',
      addComment: 'Thêm bình luận...',
      addReply: 'Thêm trả lời...',
      showAllAnnotations: 'Hiện tất cả ghi chú',
      closeAllAnnotations: 'Đóng tất cả ghi chú',
      save: 'Lưu',
      cancel: 'Hủy',
      edit: 'Sửa',
      delete: 'Xóa',
      showMore: 'thêm',
      showLess: 'ẩn bớt',
      emptyState: 'Thêm ghi chú để có thể bình luận về chúng.',
    },
    blendMode: {
      normal: 'Bình thường',
      multiply: 'Nhân',
      screen: 'Màn chắn',
      overlay: 'Phủ',
      darken: 'Làm tối',
      lighten: 'Làm sáng',
      colorDodge: 'Sáng màu',
      colorBurn: 'Cháy màu',
      hardLight: 'Ánh sáng gắt',
      softLight: 'Ánh sáng dịu',
      difference: 'Hiệu',
      exclusion: 'Loại trừ',
      hue: 'Sắc màu',
      saturation: 'Độ bão hòa',
      color: 'Màu',
      luminosity: 'Độ sáng',
    },
    print: {
      title: 'Thiết lập in',
      loading: 'Đang chuẩn bị tài liệu...',
      pages: 'Trang cần in',
      all: 'Tất cả các trang',
      current: 'Trang hiện tại ({currentPage})',
      specify: 'Chọn trang',
      specifyEG: 'ví dụ: 1-3, 5, 8-10',
      total: 'Tổng số trang của tài liệu: {totalPages}',
      annotation: 'In cả ghi chú',
      printing: 'Đang in...',
      print: 'In',
      cancel: 'Hủy',
    },
    protect: {
      title: 'Bảo vệ tài liệu',
      cancel: 'Hủy',
      apply: 'Áp dụng bảo vệ',
      applying: 'Đang áp dụng...',
      applyFailed: 'Không áp dụng được bảo vệ. Hãy thử lại.',
      removeFailed: 'Không gỡ được bảo vệ. Hãy thử lại.',
      passwordMismatch: 'Hai mật khẩu không khớp',
      noProtectionSelected: 'Chọn ít nhất một kiểu bảo vệ để áp dụng.',
      bothPasswordsNote:
        'Người mở bằng mật khẩu tài liệu sẽ bị giới hạn quyền. Dùng mật khẩu chủ sở hữu để có toàn quyền.',
      openPassword: {
        title: 'Yêu cầu mật khẩu khi mở',
        description: 'Người dùng phải nhập mật khẩu mới xem được tài liệu.',
        label: 'Mật khẩu tài liệu',
        placeholder: 'Nhập mật khẩu',
        confirm: 'Nhập lại mật khẩu',
        confirmPlaceholder: 'Nhập lại mật khẩu',
      },
      ownerPassword: {
        label: 'Mật khẩu chủ sở hữu',
        placeholder: 'Nhập mật khẩu chủ sở hữu',
        confirm: 'Nhập lại mật khẩu chủ sở hữu',
        confirmPlaceholder: 'Nhập lại mật khẩu chủ sở hữu',
      },
      permissions: {
        title: 'Giới hạn quyền',
        description: 'Giới hạn những việc người dùng làm được với tài liệu.',
        allowedActions: 'Việc được phép',
        print: 'In',
        printHighQuality: 'In chất lượng cao',
        copy: 'Sao chép nội dung',
        accessibility: 'Trích nội dung cho công cụ trợ năng',
        modify: 'Sửa nội dung',
        annotations: 'Thêm/sửa ghi chú và bình luận',
        fillForms: 'Điền biểu mẫu và ký',
        assemble: 'Ghép và trích trang',
      },
      encrypted: {
        title: 'Tài liệu đang được bảo vệ',
        description:
          'Tài liệu này được chủ sở hữu bảo vệ. Nhập mật khẩu chủ sở hữu để đổi thiết lập bảo mật.',
        enterOwnerPassword: 'Nhập mật khẩu chủ sở hữu để sửa',
        unlockAndEdit: 'Mở khóa và sửa',
      },
      modifyProtection: {
        title: 'Sửa bảo vệ',
        description: 'Chọn cách bạn muốn thay đổi việc bảo vệ tài liệu.',
        changeOption: 'Đổi mật khẩu hoặc quyền',
        changeDescription:
          'Cập nhật mật khẩu hoặc thiết lập quyền của tài liệu.',
        removeOption: 'Gỡ toàn bộ bảo vệ',
        removeDescription: 'Gỡ bảo vệ bằng mật khẩu khỏi tài liệu này.',
      },
      removeProtection: {
        title: 'Gỡ bảo vệ',
        warning: 'Bạn có chắc muốn gỡ bảo vệ không?',
        description:
          'Thao tác này gỡ toàn bộ bảo vệ bằng mật khẩu. Ai cũng có thể mở và sửa tài liệu.',
        confirm: 'Gỡ bảo vệ',
      },
    },
    security: {
      protected: {
        title: 'Tài liệu này đang được bảo vệ',
        description:
          'Tệp này được bảo vệ nên một số tính năng có thể bị tắt. Vào Bảo mật trong trình đơn tài liệu để xem hoặc mở khóa quyền.',
        viewPermissions: 'Xem quyền',
      },
      viewPermissions: {
        title: 'Quyền của tài liệu',
        description:
          'Tệp này bị chủ sở hữu giới hạn và cần mật khẩu để mở khóa một số thao tác.',
        restrictedActions: 'Việc bị giới hạn',
      },
      unlock: {
        label: 'Nhập mật khẩu chủ sở hữu để mở khóa tệp',
        placeholder: 'Nhập mật khẩu chủ sở hữu',
        button: 'Mở khóa tệp',
        invalidPassword: 'Mật khẩu không hợp lệ. Hãy thử lại.',
        failed: 'Không mở khóa được. Hãy thử lại.',
        success: 'Đã mở khóa quyền chủ sở hữu! Bạn có toàn quyền với tệp.',
      },
    },
    common: {
      close: 'Đóng',
      back: 'Quay lại',
      cancel: 'Hủy',
    },
    link: {
      title: 'Chèn liên kết',
      url: 'URL',
      page: 'Trang',
      enterUrl: 'Nhập URL',
      enterPage: 'Nhập số trang',
      pageRange: 'Trang 1 đến {totalPages}',
      link: 'Liên kết',
    },
  },
};

// App language codes the viewer ships itself, mapped to its own codes.
const BUILT_IN: Record<string, string> = {
  en: 'en',
  de: 'de',
  es: 'es',
  fr: 'fr',
  ja: 'ja',
  nl: 'nl',
  sv: 'sv',
  zh: 'zh-CN',
};

/**
 * The viewer's `i18n` option for an app language, or undefined to leave the
 * viewer in English. Passing `locales` replaces the built-in list, so it is
 * only done for the language the viewer lacks.
 */
export function editorLocale(appLanguage: string) {
  if (appLanguage === 'vi') {
    return { defaultLocale: 'vi', locales: [vietnamese] };
  }
  const code = BUILT_IN[appLanguage];
  return code ? { defaultLocale: code } : undefined;
}

export const editorVietnamese = vietnamese;

// Labels the viewer hard-codes in English instead of reading them from its
// translations, so the locale above cannot reach them.
const HARD_CODED: Record<string, Record<string, string>> = {
  vi: {
    'Open File': 'Mở tệp',
    'Set zoom': 'Đặt mức thu phóng',
    'Print Document': 'In tài liệu',
  },
};

const LABEL_ATTRIBUTES = ['title', 'aria-label'];

/**
 * Translates the viewer's hard-coded tooltips and accessible names, now and
 * as the viewer re-renders. The viewer draws inside shadow roots, which the
 * app's own phrase translator does not look into.
 */
export function localizeEditorLabels(host: Element, appLanguage: string): void {
  const labels = HARD_CODED[appLanguage];
  if (!labels) return;

  const watched = new WeakSet<Node>();
  const fix = (element: Element) => {
    for (const name of LABEL_ATTRIBUTES) {
      const translated = labels[element.getAttribute(name) ?? ''];
      if (translated) element.setAttribute(name, translated);
    }
    if (element.shadowRoot) watch(element.shadowRoot);
  };
  const scan = (root: Element | ShadowRoot) => {
    if (root instanceof Element) fix(root);
    root.querySelectorAll('*').forEach(fix);
  };
  function watch(root: Element | ShadowRoot) {
    if (watched.has(root)) return;
    watched.add(root);
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') fix(mutation.target as Element);
        mutation.addedNodes.forEach((node) => {
          if (node instanceof Element) scan(node);
        });
      }
    }).observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: LABEL_ATTRIBUTES,
    });
    scan(root);
  }
  watch(host);
}
