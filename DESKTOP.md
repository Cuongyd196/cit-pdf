# BentoPDF Desktop (Windows · macOS · Linux)

Ứng dụng BentoPDF phiên bản Desktop được phát triển bằng **Electron**, cho phép chạy hoàn toàn độc lập, tiện lợi cho người dùng cuối và hỗ trợ đa nền tảng (Windows, macOS, Linux).

---

## 1. Điểm nổi bật cho người dùng cuối

1. **Bộ cài nhẹ tối ưu (Lean Core Installer):**
   - Bộ cài chỉ chứa phần lõi ứng dụng (gộp, tách, xoay, sắp xếp, nén cơ bản, chữ ký, bảo mật, v.v.) và bộ runtime.
   - Các công cụ nặng (như chuyển đổi tài liệu Office qua LibreOffice, PyMuPDF, Ghostscript) sẽ được tải về **khi người dùng mở công cụ đó lần đầu tiên**.
   - Sau khi tải một lần, toàn bộ module được lưu trong máy và hoạt động **offline 100% vĩnh viễn**.
2. **Cài đặt cực kỳ thuận tiện:**
   - **Windows:** Bộ cài NSIS per-user (`.exe`) – **không yêu cầu quyền Administrator**. Người dùng chỉ cần nhấp đúp là cài được ngay. Có cả bản **Portable** chạy trực tiếp không cần cài đặt.
   - **macOS:** File `.dmg` hỗ trợ cả chip Intel và Apple Silicon (Universal).
   - **Linux:** File `.AppImage` (chạy ngay) và gói `.deb` (cho Ubuntu/Debian).
3. **Tích hợp hệ điều hành (Native OS Integration):**
   - Đăng ký liên kết file `.pdf` (chuột phải vào file PDF -> "Open with BentoPDF").
   - Hộp thoại lưu file tự nhiên của hệ điều hành.
   - Cơ chế Single-Instance: mở nhiều file không bị đè hoặc mở nhiều cửa sổ trùng lặp.
   - Mở các liên kết bên ngoài an toàn bằng trình duyệt mặc định của máy.

---

## 2. Nguồn tải module chính thống & An toàn bảo mật

Tất cả module WASM mở rộng được tải trực tiếp từ nguồn chính thống và kiểm tra toàn vẹn mã băm:
- **PyMuPDF WASM:** Tải từ kho chính thức npm registry (`@bentopdf/pymupdf-wasm@0.11.16.tgz`), kiểm tra chữ ký toàn vẹn **SHA-512**.
- **Ghostscript WASM:** Tải từ kho chính thức npm registry (`@bentopdf/gs-wasm@0.1.1.tgz`), kiểm tra chữ ký toàn vẹn **SHA-512**.
- **LibreOffice WASM:** Tải từ kho GitHub chính thức của dự án (`public/libreoffice-wasm`), kiểm tra chữ ký mã băm **SHA-256**.
- **CoherentPDF (cpdf):** Đã được tích hợp sẵn bên trong gói cài đặt (`desktop/bundled-modules/cpdf/`), không cần tải thêm.

---

## 3. Lệnh phát triển & Đóng gói

### Chạy ứng dụng Desktop ở chế độ phát triển:
```bash
npm run desktop
```
Lệnh này sẽ tự động:
1. Build frontend ở chế độ desktop (`VITE_DESKTOP=true`).
2. Biên dịch mã nguồn Electron trong thư mục `desktop/src/` sang `desktop/dist/`.
3. Khởi chạy cửa sổ ứng dụng Electron.

### Build bản Desktop:
```bash
npm run desktop:build
```

### Đóng gói bộ cài đặt cho Windows (.exe NSIS + Portable):
```bash
npm run desktop:dist
```
File cài đặt sau khi đóng gói sẽ nằm trong thư mục `release/`.

### Đóng gói cho tất cả nền tảng (Windows + macOS + Linux):
```bash
npm run desktop:dist:all
```

---

## 4. Tự động hóa CI/CD (GitHub Actions)

Dự án đã được cấu hình sẵn file workflow `.github/workflows/desktop-release.yml`. Khi tạo và gắn thẻ phiên bản mới (`git tag v2.8.9 && git push --tags`):
- GitHub Actions sẽ chạy đồng thời trên 3 máy ảo Windows, macOS, Ubuntu.
- Tự động đóng gói và đính kèm các file `.exe`, `.dmg`, `.AppImage`, `.deb` vào mục **Releases** của GitHub.
