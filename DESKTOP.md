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

- **Trang chủ:** ô kéo thả / nút Mở tệp (nhiều tệp, mỗi tệp một tab trong trình xem), bảng tệp gần đây (tên, thư mục, lần mở cuối; lưu ở `userData/recent-files.json`), cột phải gồm ô tìm công cụ, 8 công cụ hay dùng (yêu thích → dùng gần đây → mặc định) và nút "Tất cả công cụ". Lưới công cụ đầy đủ nằm ở `index.html#tools`, mỗi công cụ một dòng gọn (biểu tượng và tên; mô tả hiện khi rê chuột).
- **Chế độ làm việc** (`src/js/desktop/workspace.ts`): khi Trình chỉnh sửa PDF, Ký PDF, Nhân đôi & Sắp xếp, Xoay, Xoay tuỳ chỉnh hoặc Xoá trang đã mở tệp, thẻ công cụ (tiêu đề, ô kéo thả, dòng tệp) thu thành một thanh gồm nút quay lại, tên công cụ, tệp, tuỳ chọn của công cụ và nút Lưu; vùng làm việc cao hết cửa sổ. Nút của công cụ được chuyển lên thanh (không sao chép), nên mã của công cụ vẫn tìm thấy chúng theo id. Thêm công cụ: một mục trong `WORKSPACE_TOOLS`. Ở các công cụ khác, nút chạy chính (`#process-btn`…) dính ở đáy cửa sổ, trên thanh trạng thái, khi trang dài hơn cửa sổ.
- **Giao diện:** font Be Vietnam Pro (gói `@fontsource/be-vietnam-pro`, đóng gói sẵn). Biểu tượng một họ: trang công cụ khai báo Lucide (`data-lucide`), bản desktop vẽ biểu tượng Phosphor tương ứng (`src/js/desktop/icons.ts`, bảng `icon-map.ts`; tên chưa có trong bảng giữ nguyên Lucide). Giao diện Sáng / Tối / Theo hệ thống (`cit:theme` = `light` | `dark` | `system`, mặc định `dark`), đổi trong Cài đặt.
- **Ký PDF:** ảnh chữ ký/con dấu giữ màu (`sign-images.ts`), cả khi chọn ở tab "Hình ảnh" của hộp "Thêm chữ ký"; ảnh đã lưu nằm trong IndexedDB (`sign-library.ts`) và hiện trong menu chữ ký của PDF.js. Nút tải và Ctrl+S trong khung xem đi qua đường lưu của công cụ.
- **Lưu / Lưu thành:** ở các công cụ có thanh làm việc, khi tệp mở có đường dẫn thật, nút Lưu (Ctrl+S) ghi đè lên tệp gốc (lần đầu hỏi, có ô "Không hỏi lại" lưu ở `cit:overwrite-confirmed`); "Lưu thành…" (Ctrl+Shift+S) mở hộp thoại trong thư mục gốc với tên "<tên> (đã sửa).pdf". Trang gửi `setSaveTarget(mode, path)` ngay trước lượt tải; `main.ts` chỉ nhận đường dẫn `.pdf` trong `allowedOpenPaths`, ghi ra tệp tạm `.<tên>.cit-saving` cạnh tệp gốc rồi đổi tên đè lên; tệp gốc bị khoá thì lưu thành "<tên> (2).pdf" và báo. Trình chỉnh sửa PDF chỉ ghi đè khi đang mở đúng một tài liệu (`data-editor-documents`).
- **Trang công cụ dạng biểu mẫu** (`src/js/desktop/form-layout.ts`): phần lớn trang công cụ là một thẻ (tiêu đề, ô kéo thả, danh sách tệp, khối tuỳ chọn kết thúc bằng `#process-btn`). Khi đã có tệp, thẻ chia hai cột: bên trái là tệp và ảnh trang đầu (khi chỉ có một tệp PDF), bên phải là tuỳ chọn, nút chạy vẫn ghim ở đáy cửa sổ. Các phần tử được di chuyển chứ không sao chép, nên mã của công cụ vẫn tìm thấy chúng theo id. Trang có danh sách tệp hoặc ảnh xem trước nằm trong khối tuỳ chọn (Gộp, Chia, Điều chỉnh màu…) giữ một cột (`SINGLE_COLUMN`); trang có không gian làm việc riêng (`workspace.ts`) thì không áp dụng. Cửa sổ hẹp hơn 960px cũng giữ một cột.
- **Studio và thanh tab** (`src/js/desktop/studio/`): trên tài liệu trong trình xem là một thanh tab kiểu PdfCraft: **Đọc · Trang · Sửa · Chuyển đổi · Tối ưu & bảo mật · Tất cả công cụ**, mỗi tab một thanh công cụ (`ribbon.ts`), cuối hàng tab là Hoàn tác/Làm lại/Lưu thành/Lưu. Tất cả lệnh nằm trong một danh sách (`commands.ts`): lệnh Studio (mở tuỳ chọn ở ngăn bên phải), lệnh của lưới trang, hoặc liên kết sang trang riêng của công cụ (mang theo tài liệu, có dấu ↗). Bảng "Tất cả công cụ" bên trái liệt kê mọi công cụ; công cụ nào có lệnh làm tại chỗ (`standsFor`) thì mở đúng tab thay vì rời trang. Tab **Trang** thay khung đọc bằng lưới trang (`page-grid.ts`): bấm/Ctrl/Shift để chọn (`page-selection.ts`), kéo thả đổi thứ tự, xoay, xoá, trích ra tệp, chèn PDF, thêm trang trống (`page-ops.ts`); bấm đúp đọc trang đó. Tab **Chuyển đổi** làm PDF sang Word (tự OCR bản scan, tiến độ từng trang, `utils/pdf-to-docx.ts`) và sang văn bản ngay trên bản đang mở, gồm cả thay đổi chưa lưu; tệp kết quả được gợi ý lưu cạnh tệp gốc. Mỗi thay đổi là một bước Hoàn tác/Làm lại (Ctrl+Z/Ctrl+Y, tối đa 20 bước, `history.ts`), lưu một lần (Lưu đè / Lưu thành như trên). Trình xem và Studio nói chuyện qua `src/js/logic/viewer-document.ts`; phím bấm trong khung PDF.js được chuyển ra trang bằng sự kiện `cit:viewer-keydown`. Tab chưa lưu có dấu "•", đóng tab thì hỏi, rời trang thì `beforeunload` → hộp "Thay đổi chưa lưu" của `main.ts`. Thêm công cụ có tuỳ chọn: một mục trong `STUDIO_TOOLS` (`tools.ts`) và một lệnh trong `commands.ts`; `makesFile` lưu ra tệp mới (có thể khác PDF, `type`) bằng Lưu thành ở thư mục tệp gốc thay vì thêm bước. "Chỉnh sửa & ghi chú" (`opensEditor`) mở trình chỉnh sửa EmbedPDF phủ lên khung xem; Xong → một bước lịch sử, Huỷ → bỏ, Ctrl+S → Xong rồi lưu, đổi tab → tự Xong. Khởi tạo và xuất tệp dùng chung với trang Trình chỉnh sửa PDF qua `src/js/logic/embed-editor.ts`.
- Sau khi lưu, thông báo "Đã lưu" ở góc thay cho hộp "Thành công" của công cụ (hộp đó tự đóng như khi bấm OK).
- **Thanh bên trái:** ở mọi màn hình là một dải biểu tượng (trang chủ, Xem PDF, Tất cả công cụ, công cụ ghim, Cài đặt, Giới thiệu). Nút Tất cả công cụ, hoặc `Ctrl+K` ngoài trang chủ, mở danh sách đầy đủ nổi trên trang: ô tìm, công cụ ghim, dùng gần đây và các nhóm công cụ; `Esc` hoặc bấm ra ngoài để đóng.
- **Thanh dưới:** phiên bản và trạng thái bộ xử lý.
- **Màu chủ đạo:** xanh teal; phông chữ Inter (hỗ trợ đủ dấu tiếng Việt).
- **Trang Cài đặt** (`cit-settings.html`), gồm ba phần theo thứ tự:
  1. Giao diện: sáng/tối, ngôn ngữ, toàn chiều rộng, chế độ gọn, tự động kiểm tra cập nhật (mặc định bật: mỗi ngày một lần, có bản mới thì báo ở trang chủ).
  2. Bộ xử lý: xem trạng thái, tải về hoặc xoá từng bộ xử lý nặng.
  3. Phím tắt: tìm, gán, nhập, xuất, đặt lại.
- **Trang Giới thiệu** (`cit-about.html`): phiên bản, giấy phép, thông báo sửa đổi và đường dẫn tới mã nguồn. Nút **Kiểm tra cập nhật** so phiên bản đang chạy với bản phát hành mới nhất trên GitHub và dẫn tới trang tải; chỉ chạy khi người dùng bấm, không tự tải hay tự cài.

### Mở và xem PDF

Mở một tệp PDF từ hệ điều hành, từ menu **Tệp → Mở tệp PDF…** (`Ctrl+O`) hoặc từ công cụ "Xem PDF" sẽ vào thẳng trình xem. Trình xem mở nhiều tệp cùng lúc, mỗi tệp một tab; nút **+** trên thanh tab mở thêm tệp, và các tab được giữ lại khi sang công cụ khác rồi quay về (trong cùng cửa sổ). Phía trên tài liệu là thanh tab công cụ (xem Studio ở trên). Thanh công cụ của PDF.js (tìm, chuyển trang, thu phóng) chỉ hiện ở tab Đọc; các tab khác dùng thanh của mình, nên trên tài liệu luôn chỉ có hai hàng. `Ctrl+F` ở tab khác chuyển về Đọc. Tên tệp, In, Xoay và nút đóng của PDF.js được bỏ vì tab và ribbon đã có.

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

Một lần tải không nhận thêm dữ liệu trong 60 giây thì dừng và báo lỗi. Bộ xử lý được giải nén vào thư mục tạm rồi mới chuyển vào chỗ, nên lần cài dở không bao giờ bị coi là đã cài.

**Mạng chặn nguồn tải (gói offline).** `npm run desktop:modules-pack` tải mọi bộ xử lý không có trong bộ cài vào `release/cit-pdf-modules/` (khoảng 125 MB, kèm `DOC-TOI.txt`), kiểm tra mã băm. Chép thư mục đó sang máy khách rồi chọn **Cài đặt › Bộ xử lý › Cài từ thư mục…**. Khi một lần tải thất bại, hộp thoại lỗi cũng đưa ra lựa chọn này. Tệp trong gói được kiểm tra bằng đúng mã băm như khi tải.

PyMuPDF chạy trong một worker ([src/js/utils/pymupdf.worker.ts](src/js/utils/pymupdf.worker.ts)) nên chuyển đổi dài không làm đứng cửa sổ. Riêng `open()` (trả về đối tượng tài liệu có phương thức đồng bộ) chạy trên trang qua `loadPyMuPDFMainThread()`.

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
