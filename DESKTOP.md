# CIT-PDF Desktop

CIT-PDF là bản desktop của [BentoPDF](https://github.com/alam00000/bentopdf), đóng gói bằng **Electron**. Mọi thao tác với tệp PDF chạy ngay trên máy người dùng, không gửi tệp đi đâu.

Tài liệu này dành cho người phát triển và người đóng gói bản cài. Giới thiệu chung về dự án nằm ở [README.md](README.md).

---

## 1. Người dùng cuối nhận được gì

### Bộ cài

- **Windows:** bộ cài NSIS theo từng người dùng (`.exe`), không cần quyền Administrator, cho chọn thư mục cài. Có kèm bản **Portable** chạy không cần cài.
- **macOS** (`.dmg`) và **Linux** (`.AppImage`, `.deb`) đã có cấu hình trong [electron-builder.json](electron-builder.json) nhưng chưa được build và thử trong fork này.
- Tệp `.pdf` được đăng ký "Mở bằng CIT-PDF".
- Mở thêm tệp khi app đang chạy: tệp vào trình xem thành một tab mới cạnh các tệp đang mở. Riêng khi cửa sổ đang ở một công cụ có sẵn tài liệu thì giữ nguyên, tệp mới mở ở cửa sổ riêng. **Tệp → Cửa sổ mới** (`Ctrl+Shift+N`) mở thêm cửa sổ trống.

### Giao diện

- **Trang chủ:** ô kéo thả / nút Mở tệp (nhiều tệp, mỗi tệp một tab trong trình xem), bảng tệp gần đây (tên, thư mục, lần mở cuối; lưu ở `userData/recent-files.json`), cột phải gồm ô tìm công cụ, 8 công cụ hay dùng (yêu thích → dùng gần đây → mặc định) và nút "Tất cả công cụ". Lưới công cụ đầy đủ nằm ở `index.html#tools`. Ở trang chủ và khi đang đọc, thanh bên thu thành dải biểu tượng.
- **Chế độ làm việc** (`src/js/desktop/workspace.ts`): khi Trình chỉnh sửa PDF hoặc Ký PDF đã mở tệp, thẻ công cụ (tiêu đề, ô kéo thả, dòng tệp) thu thành một thanh gồm nút quay lại, tên công cụ, tệp, tuỳ chọn của công cụ và nút Lưu; vùng làm việc cao hết cửa sổ. Nút của công cụ được chuyển lên thanh (không sao chép), nên mã của công cụ vẫn tìm thấy chúng theo id. Thêm công cụ: một mục trong `WORKSPACE_TOOLS`.
- **Ký PDF:** ảnh chữ ký/con dấu giữ màu (`sign-images.ts`), cả khi chọn ở tab "Hình ảnh" của hộp "Thêm chữ ký"; ảnh đã lưu nằm trong IndexedDB (`sign-library.ts`) và hiện trong menu chữ ký của PDF.js. Nút tải và Ctrl+S trong khung xem đi qua đường lưu của công cụ.
- Sau khi lưu, thông báo "Đã lưu" ở góc thay cho hộp "Thành công" của công cụ (hộp đó tự đóng như khi bấm OK).
- **Thanh bên trái:** ô tìm công cụ, mục yêu thích, công cụ dùng gần đây và các nhóm công cụ.
- **Thanh dưới:** nút đổi nhanh giao diện sáng/tối.
- **Màu chủ đạo:** xanh teal; phông chữ Inter (hỗ trợ đủ dấu tiếng Việt).
- **Trang Cài đặt** (`cit-settings.html`), gồm ba phần theo thứ tự:
  1. Giao diện: sáng/tối, ngôn ngữ, toàn chiều rộng, chế độ gọn, tự động kiểm tra cập nhật (mặc định bật: mỗi ngày một lần, có bản mới thì báo ở trang chủ).
  2. Bộ xử lý: xem trạng thái, tải về hoặc xoá từng bộ xử lý nặng.
  3. Phím tắt: tìm, gán, nhập, xuất, đặt lại.
- **Trang Giới thiệu** (`cit-about.html`): phiên bản, giấy phép, thông báo sửa đổi và đường dẫn tới mã nguồn. Nút **Kiểm tra cập nhật** so phiên bản đang chạy với bản phát hành mới nhất trên GitHub và dẫn tới trang tải; chỉ chạy khi người dùng bấm, không tự tải hay tự cài.

### Mở và xem PDF

Mở một tệp PDF từ hệ điều hành, từ menu **Tệp → Mở tệp PDF…** (`Ctrl+O`) hoặc từ công cụ "Xem PDF" sẽ vào thẳng trình xem. Trình xem mở nhiều tệp cùng lúc, mỗi tệp một tab; nút **+** trên thanh tab mở thêm tệp, và các tab được giữ lại khi sang công cụ khác rồi quay về (trong cùng cửa sổ). Phía trên tài liệu có một dải thao tác nhanh (Nén, Tách, Xoay, Sắp xếp trang, Ghi chú, Sửa chữ, Sang Word, OCR, Ký, Đặt mật khẩu, Khác): bấm là sang công cụ đó với tệp đang xem đã nạp sẵn. Khi đang có tài liệu mở, thanh bên thu lại thành một cột biểu tượng để nhường chỗ cho trang; nút đầu dải thao tác bật lại thanh bên, và lựa chọn này được ghi nhớ.

Khi một công cụ lưu xong kết quả, góc dưới bên phải hiện thông báo "Đã lưu" kèm nút **Xem kết quả** (mở tệp PDF vừa lưu thành một tab trong trình xem, cạnh tệp gốc) hoặc **Mở tệp** (với kết quả không phải PDF), và **Mở thư mục**.

Tệp đang dùng ở một công cụ cũng đi theo khi chọn công cụ khác ở thanh bên, không phải chọn lại. Công cụ không nhận PDF (ví dụ JPG sang PDF) thì bỏ qua.

### In

Trình xem có hộp thoại in riêng (`Ctrl+P`), thay cho hộp thoại in của hệ điều hành:

- Xem trước từng trang trước khi in.
- Chọn máy in (máy in mặc định của hệ điều hành được chọn sẵn), số bản, khoảng trang, khổ giấy (A3, A4, A5, Letter, Legal), hướng giấy, in hai mặt, màu hoặc đen trắng.
- Thiết lập lần trước được ghi nhớ.

Hộp thoại in này hiện chỉ có ở trình xem. Các trang khác (Điền biểu mẫu, Ký…) chưa dùng.

### Đa ngôn ngữ

- Mặc định là **tiếng Việt**; đổi ngôn ngữ trong Cài đặt.
- **Tiếng Việt và tiếng Anh** là hai ngôn ngữ được rà soát đầy đủ. Các ngôn ngữ khác thừa hưởng bản dịch của BentoPDF: phần chưa dịch sẽ hiện tiếng Anh.
- Thanh menu và các hộp thoại hệ thống đổi theo ngôn ngữ của ứng dụng (tiếng Việt, còn lại dùng tiếng Anh) và được ghi nhớ cho lần mở sau.

### Bộ xử lý nặng tải khi cần

Bộ cài chỉ chứa phần lõi. Các bộ xử lý nặng và gói OCR được tải về **lần đầu người dùng mở công cụ cần đến chúng**, sau khi họ đồng ý trong hộp thoại xác nhận. Tải xong thì dùng offline.

| Bộ xử lý                                | Dùng cho                                                                         | Nguồn                                                                             | Kiểm tra toàn vẹn |
| --------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------- |
| CoherentPDF (cpdf) 2.5.5                | Gộp, và một số thao tác trang                                                    | Có sẵn trong bộ cài                                                               | Không cần tải     |
| PyMuPDF 0.11.16                         | PDF sang Word/Excel/Markdown, trích bảng, sách điện tử                           | npm registry, `@bentopdf/pymupdf-wasm`                                            | SHA-512           |
| Ghostscript 0.1.1                       | PDF/A, chuyển phông thành nét                                                    | npm registry, `@bentopdf/gs-wasm`                                                 | SHA-512           |
| LibreOffice                             | Word, Excel, PowerPoint… sang PDF                                                | Kho mã nguồn BentoPDF                                                             | SHA-256 từng tệp  |
| OCR Tesseract 7.0.0                     | Nhận dạng chữ trong tài liệu quét (khoảng 8 MB, gồm phông Noto Sans cho lớp chữ) | jsDelivr, `tesseract.js` và `tesseract.js-core`; GitHub, `googlefonts/noto-fonts` | SHA-256 từng tệp  |
| Gói ngôn ngữ OCR: tiếng Việt, tiếng Anh | Dữ liệu nhận dạng cho từng ngôn ngữ (1,4 MB và 3 MB), mỗi gói tải riêng          | jsDelivr, `@tesseract.js-data`                                                    | SHA-256 từng tệp  |

Danh sách, phiên bản và mã băm khai báo trong [desktop/app/modules-manifest.json](desktop/app/modules-manifest.json). Bộ xử lý đã tải nằm trong thư mục `modules` thuộc thư mục dữ liệu người dùng của ứng dụng.

---

## 2. Lệnh phát triển và đóng gói

```bash
npm run desktop            # build rồi mở ứng dụng
npm run desktop:build      # chỉ build
npm run desktop:dist       # build + đóng gói cho Windows, kết quả trong release/
npm run desktop:dist:all   # build + đóng gói cho Windows, macOS, Linux
```

`npm run desktop:build` làm các bước sau ([scripts/build-desktop.mjs](scripts/build-desktop.mjs)):

1. Build phần web ở chế độ desktop (`VITE_DESKTOP=true`, `SIMPLE_MODE=true`, thương hiệu CIT-PDF, ngôn ngữ mặc định `vi`).
2. Biên dịch `desktop/src/` sang `desktop/dist/`.
3. Chép cpdf vào `desktop/bundled-modules/cpdf/dist/`.
4. Chép phần web sang `desktop/dist-web/`, bỏ các tệp WASM nặng.

Lưu ý khi làm việc:

- **Phiên bản ứng dụng** lấy từ `version` trong [desktop/package.json](desktop/package.json), không phải `package.json` ở gốc.
- **Trong terminal của VS Code** biến `ELECTRON_RUN_AS_NODE=1` được đặt sẵn, khiến Electron chạy như Node thường. Bỏ biến này trước khi chạy `electron` trực tiếp.
- **Tải Electron chậm:** đặt `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` và `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/` trước khi `npm install` hoặc đóng gói.
- **Menu dành cho lập trình viên** (Tải lại, Tải lại hoàn toàn, Công cụ nhà phát triển) chỉ hiện khi chạy từ mã nguồn, không có trong bản cài.
- **Thử in mà không ra giấy:** đặt biến `CIT_PRINT_TO_FILE` thành đường dẫn một tệp PDF; lệnh in sẽ ghi bố cục in ra tệp đó thay vì gửi tới máy in.
- Fork này **không có CI**: chạy `npx tsc --noEmit` và `npm run test:run` bằng tay trước khi phát hành.

---

## 3. Cấu trúc mã nguồn

| Vị trí                                                           | Vai trò                                                                         |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [desktop/src/main.ts](desktop/src/main.ts)                       | Tiến trình chính: cửa sổ, menu, mở tệp, in, các kênh IPC                        |
| [desktop/src/protocol.ts](desktop/src/protocol.ts)               | Giao thức `app://bentopdf` phục vụ phần web, kèm header COOP/COEP               |
| [desktop/src/modules-manager.ts](desktop/src/modules-manager.ts) | Tải, kiểm tra mã băm và gắn các bộ xử lý nặng                                   |
| [desktop/src/preload.ts](desktop/src/preload.ts)                 | Cầu nối `window.bentoDesktop` cho phần web                                      |
| [desktop/src/ui-strings.ts](desktop/src/ui-strings.ts)           | Chữ của menu và hộp thoại hệ thống (vi/en)                                      |
| [src/js/desktop/](src/js/desktop/)                               | Phần web chỉ dành cho desktop: khung giao diện, in, cài đặt, giao diện sáng/tối |
| [src/js/i18n/phrases.ts](src/js/i18n/phrases.ts)                 | Lớp dịch theo câu cho phần chữ chưa có khoá i18n                                |
| [public/locales/vi/phrases.json](public/locales/vi/phrases.json) | Từ điển câu tiếng Việt                                                          |

### Thêm chữ mới vào giao diện

- **Trang công cụ:** viết tiếng Anh trong mã, rồi thêm một dòng vào `public/locales/vi/phrases.json` (câu tiếng Anh → câu tiếng Việt). Giá trị thay đổi lúc chạy viết thành `{0}`, `{1}`, ví dụ `"Loading page {0}..."`.
- **Khung giao diện desktop** (thanh bên, cài đặt, hộp thoại in): thêm vào [src/js/desktop/strings.ts](src/js/desktop/strings.ts).
- **Menu và hộp thoại hệ thống:** thêm vào `desktop/src/ui-strings.ts`.
- Nội dung không được dịch (tên tệp, văn bản lấy từ tài liệu của người dùng): gắn thuộc tính `data-no-translate` lên phần tử chứa nó.

### Thêm một bộ xử lý nặng

Cần ba chỗ: một mục trong `modules-manifest.json`, đường dẫn mặc định trong [src/js/utils/wasm-provider.ts](src/js/utils/wasm-provider.ts) (`DESKTOP_DEFAULTS`, trỏ đúng thư mục con chứa tệp script), và lời gọi `await ensureDesktopModules([...])` trong bộ nạp trước khi tải tệp.

---

## 4. Giấy phép khi phát hành

CIT-PDF là bản sửa đổi của BentoPDF và phát hành theo **GNU AGPL-3.0**. Mỗi bản phát hành cần giữ đủ các điểm sau:

- Mã nguồn đầy đủ, gồm cả phần sửa đổi, công khai tại <https://github.com/Cuongyd196/cit-pdf>, và trang Giới thiệu trong ứng dụng dẫn tới đó.
- Trang Giới thiệu ghi rõ đây là bản đã sửa đổi so với BentoPDF.
- Bộ cài kèm `LICENSE.txt` (AGPL-3.0 của ứng dụng) và `licenses/coherentpdf-LICENSE.md` (giấy phép của cpdf, bộ xử lý duy nhất nằm sẵn trong bộ cài), cả hai trong thư mục `resources` của bản cài.
- PyMuPDF, Ghostscript và LibreOffice không nằm trong bộ cài; chúng được tải từ nguồn gốc kèm giấy phép riêng.

---

## 5. Phát hành một phiên bản

1. Sửa `version` trong `desktop/package.json`.
2. Chạy `npx tsc --noEmit` và `npm run test:run`.
3. Chạy `npm run desktop:dist`; bộ cài nằm trong `release/`.
4. Cài thử trên một máy chưa từng cài CIT-PDF: mở tệp PDF từ Explorer, chạy một công cụ cần tải bộ xử lý, in thử một trang.
5. Gắn thẻ phiên bản, đẩy mã nguồn lên GitHub và tạo Release kèm các tệp trong `release/`. Thẻ của Release phải là số phiên bản (`1.1.0` hoặc `v1.1.0`) và Release phải được đánh dấu là bản mới nhất: nút Kiểm tra cập nhật đọc đúng thẻ đó.
