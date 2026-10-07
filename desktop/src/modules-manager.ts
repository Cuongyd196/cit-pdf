import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { app, dialog, BrowserWindow } from 'electron';
import * as tar from 'tar';
import type {
  DesktopModuleName,
  ModulesManifest,
  ModuleManifestItem,
  ModuleProgress,
  ModuleStatus,
  EnsureResult,
} from './types.js';

export class ModulesManager {
  private manifest: ModulesManifest;
  private userModulesDir: string;
  private bundledModulesDir: string;

  constructor(manifestPath: string) {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    this.manifest = JSON.parse(raw) as ModulesManifest;

    this.userModulesDir = path.join(app.getPath('userData'), 'modules');
    fs.mkdirSync(this.userModulesDir, { recursive: true });

    // In packaged app, bundled modules might reside in resources/modules or appPath/bundled-modules
    const candidate1 = path.join(app.getAppPath(), 'bundled-modules');
    const candidate2 = path.join(
      app.getAppPath(),
      'desktop',
      'bundled-modules'
    );
    this.bundledModulesDir = fs.existsSync(candidate1)
      ? candidate1
      : fs.existsSync(candidate2)
        ? candidate2
        : path.join(process.resourcesPath, 'modules');
  }

  getManifestItem(name: DesktopModuleName): ModuleManifestItem | undefined {
    return this.manifest.modules[name];
  }

  getModuleDir(name: DesktopModuleName): string | null {
    // 1. Check user modules directory first
    const userPath = path.join(this.userModulesDir, name);
    const item = this.getManifestItem(name);
    if (!item) return null;

    if (fs.existsSync(path.join(userPath, item.probe))) {
      return userPath;
    }

    // 2. Check bundled modules directory
    const bundledPath = path.join(this.bundledModulesDir, name);
    if (fs.existsSync(path.join(bundledPath, item.probe))) {
      return bundledPath;
    }

    return null;
  }

  isInstalled(name: DesktopModuleName): boolean {
    return this.getModuleDir(name) !== null;
  }

  getStatus(): ModuleStatus[] {
    return Object.entries(this.manifest.modules).map(([key, item]) => {
      const name = key as DesktopModuleName;
      const dir = this.getModuleDir(name);
      return {
        name,
        label: item.label,
        version: item.version,
        source: item.source,
        size: item.size ?? 0,
        installed: dir !== null,
        bundled: dir !== null && !dir.startsWith(this.userModulesDir),
      };
    });
  }

  /** Delete a downloaded module from the user data directory. */
  removeModule(name: DesktopModuleName): boolean {
    if (!this.getManifestItem(name)) return false;
    const userPath = path.join(this.userModulesDir, name);
    if (!fs.existsSync(userPath)) return false;
    fs.rmSync(userPath, { recursive: true, force: true });
    return true;
  }

  /**
   * Resolve a mount path such as '/modules/pymupdf/dist/index.js' or '/libreoffice-wasm/soffice.wasm.gz'
   * to a real file path on disk, if installed.
   */
  resolveMountedFile(urlPath: string): string | null {
    for (const [name, item] of Object.entries(this.manifest.modules)) {
      const mount = item.mount.startsWith('/') ? item.mount : `/${item.mount}`;
      if (urlPath.startsWith(mount)) {
        const subPath = urlPath.slice(mount.length);
        const moduleDir = this.getModuleDir(name as DesktopModuleName);
        if (moduleDir) {
          const candidate = path.join(moduleDir, subPath);
          if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return candidate;
          }
        }
      }
    }
    return null;
  }

  async ensureModules(
    names: DesktopModuleName[],
    onProgress?: (p: ModuleProgress) => void,
    win?: BrowserWindow | null
  ): Promise<EnsureResult> {
    const needed = names.filter((n) => !this.isInstalled(n));
    if (needed.length === 0) {
      return { ok: true };
    }

    // Prompt user confirmation with sizes
    const descriptions = needed.map((n) => {
      const item = this.getManifestItem(n);
      const label = item?.label?.vi || item?.label?.en || n;
      const mb = item?.size ? (item.size / (1024 * 1024)).toFixed(1) : '?';
      return `• ${label} (~${mb} MB)`;
    });

    if (win) {
      const choice = await dialog.showMessageBox(win, {
        type: 'question',
        buttons: ['Tải về (Download)', 'Hủy (Cancel)'],
        defaultId: 0,
        cancelId: 1,
        title: 'Cần tải thêm thành phần xử lý',
        message:
          'Tính năng này cần tải thêm module xử lý từ nguồn chính thống:',
        detail:
          descriptions.join('\n') +
          '\n\nSau khi tải xong, ứng dụng sẽ hoạt động offline hoàn toàn.',
      });

      if (choice.response !== 0) {
        return { ok: false, cancelled: true };
      }
    }

    for (const name of needed) {
      try {
        await this.downloadAndInstallModule(name, onProgress);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      }
    }

    return { ok: true };
  }

  private async downloadAndInstallModule(
    name: DesktopModuleName,
    onProgress?: (p: ModuleProgress) => void
  ): Promise<void> {
    const item = this.getManifestItem(name);
    if (!item) {
      throw new Error(`Module ${name} not found in manifest`);
    }

    const label = item.label?.vi || item.label?.en || name;
    const destDir = path.join(this.userModulesDir, name);
    const tmpDir = path.join(this.userModulesDir, '.tmp', name);
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
      if (item.kind === 'npm-tarball') {
        if (!item.url) throw new Error(`Missing url for module ${name}`);
        const tarPath = path.join(tmpDir, `${name}.tgz`);

        await this.downloadFile(item.url, tarPath, (received, total) => {
          onProgress?.({
            name,
            label,
            received,
            total: total || item.size || 0,
          });
        });

        // Verify integrity if provided
        if (item.integrity && item.integrity.startsWith('sha512-')) {
          const expectedBase64 = item.integrity.replace('sha512-', '');
          const fileBuf = fs.readFileSync(tarPath);
          const actualBase64 = crypto
            .createHash('sha512')
            .update(fileBuf)
            .digest('base64');
          if (actualBase64 !== expectedBase64) {
            throw new Error(
              `Integrity check failed for ${name}. Expected ${expectedBase64}, got ${actualBase64}`
            );
          }
        }

        // Extract tarball (npm packages are wrapped inside a "package/" root directory)
        fs.mkdirSync(destDir, { recursive: true });
        await tar.x({
          file: tarPath,
          cwd: destDir,
          strip: 1,
        });
      } else if (item.kind === 'files' && item.files) {
        fs.mkdirSync(destDir, { recursive: true });
        let totalReceivedSoFar = 0;
        const totalSize = item.size || 0;

        for (const f of item.files) {
          const filePath = path.join(destDir, f.path);
          fs.mkdirSync(path.dirname(filePath), { recursive: true });

          let currentFileReceived = 0;
          await this.downloadFile(f.url, filePath, (rec) => {
            currentFileReceived = rec;
            onProgress?.({
              name,
              label,
              received: totalReceivedSoFar + currentFileReceived,
              total: totalSize,
            });
          });
          totalReceivedSoFar += currentFileReceived;

          if (f.sha256) {
            const fileBuf = fs.readFileSync(filePath);
            const actualHex = crypto
              .createHash('sha256')
              .update(fileBuf)
              .digest('hex');
            if (actualHex.toLowerCase() !== f.sha256.toLowerCase()) {
              throw new Error(
                `SHA-256 check failed for ${f.path}. Expected ${f.sha256}, got ${actualHex}`
              );
            }
          }
        }
      }

      // Verify probe exists
      if (!fs.existsSync(path.join(destDir, item.probe))) {
        throw new Error(
          `Installation verification failed: probe file "${item.probe}" not found after extracting ${name}`
        );
      }
    } finally {
      // Clean up tmp dir
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }

  private async downloadFile(
    url: string,
    destPath: string,
    onProgress: (received: number, total: number) => void
  ): Promise<void> {
    const response = await fetch(url);
    if (!response.ok || !response.body) {
      throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
    }

    const contentLength = Number(response.headers.get('content-length') || '0');
    let received = 0;

    const fileStream = fs.createWriteStream(destPath);
    const reader = response.body.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        received += value.length;
        fileStream.write(Buffer.from(value));
        onProgress(received, contentLength);
      }
    }

    await new Promise<void>((resolve, reject) => {
      fileStream.end((err: unknown) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}
