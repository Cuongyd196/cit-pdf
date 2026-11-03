import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { once } from 'node:events';
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
import { getUiLanguage, ui } from './ui-strings.js';

const DOWNLOAD_STALL_MS = 60_000;

/** Puts a module's source file at destPath: downloaded, or copied. */
type FileSource = (
  url: string,
  destPath: string,
  onProgress: (received: number, total: number) => void
) => Promise<void>;

export class ModulesManager {
  private manifest: ModulesManifest;
  private userModulesDir: string;
  private bundledModulesDir: string;
  private installing = new Map<DesktopModuleName, Promise<void>>();

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
    this.dropDownloadedCopiesOfBundled();
  }

  /**
   * A module downloaded before the installer started carrying it is a
   * second copy (the user's copy wins lookups, so it would keep showing as
   * downloaded). Remove that copy when the installer's one is there.
   */
  private dropDownloadedCopiesOfBundled(): void {
    for (const [name, item] of Object.entries(this.manifest.modules)) {
      if (!item.bundled) continue;
      const shipped = path.join(this.bundledModulesDir, name, item.probe);
      const userPath = path.join(this.userModulesDir, name);
      if (!fs.existsSync(shipped) || !fs.existsSync(userPath)) continue;
      try {
        fs.rmSync(userPath, { recursive: true, force: true });
        console.log(`[Modules] Removed downloaded copy of bundled ${name}`);
      } catch (e) {
        console.warn(`[Modules] Could not remove ${userPath}:`, e);
      }
    }
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
      const label =
        item?.label?.[getUiLanguage()] ||
        item?.label?.en ||
        item?.label?.vi ||
        n;
      const mb = item?.size ? (item.size / (1024 * 1024)).toFixed(1) : '?';
      return `• ${label} (~${mb} MB)`;
    });

    if (win) {
      const text = ui();
      const choice = await dialog.showMessageBox(win, {
        type: 'question',
        buttons: [text.download, text.cancel],
        defaultId: 0,
        cancelId: 1,
        title: text.downloadModulesTitle,
        message: text.downloadModulesMessage,
        detail: `${descriptions.join('\n')}\n\n${text.downloadModulesDetail}`,
      });

      if (choice.response !== 0) {
        return { ok: false, cancelled: true };
      }
    }

    for (const name of needed) {
      try {
        if (this.isInstalled(name)) continue;
        // Two windows asking for one module share its download: both would
        // otherwise write the same staging directory.
        let install = this.installing.get(name);
        if (!install) {
          install = this.downloadAndInstallModule(name, onProgress).finally(
            () => this.installing.delete(name)
          );
          this.installing.set(name, install);
        }
        await install;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      }
    }

    return { ok: true };
  }

  /** The names an offline pack gives a module's files: each URL's last part. */
  packFiles(name: DesktopModuleName): string[] {
    const item = this.getManifestItem(name);
    if (!item) return [];
    const urls =
      item.kind === 'npm-tarball'
        ? [item.url ?? '']
        : (item.files ?? []).map((f) => f.url);
    return urls
      .filter(Boolean)
      .map((url) =>
        decodeURIComponent(path.posix.basename(new URL(url).pathname))
      );
  }

  /**
   * Installs from a folder each missing module whose files are all there:
   * an offline pack (`npm run desktop:modules-pack`) copied from a machine
   * with access to the sources, for networks that block them. The files
   * are checked against the same hashes as a download.
   */
  async installFromFolder(
    dir: string,
    onProgress?: (p: ModuleProgress) => void
  ): Promise<{
    installed: DesktopModuleName[];
    failed: Array<{ name: DesktopModuleName; error: string }>;
  }> {
    const installed: DesktopModuleName[] = [];
    const failed: Array<{ name: DesktopModuleName; error: string }> = [];
    const copyFromDir: FileSource = async (url, destPath, progress) => {
      const name = decodeURIComponent(
        path.posix.basename(new URL(url).pathname)
      );
      const from = path.join(dir, name);
      await fs.promises.copyFile(from, destPath);
      const { size } = fs.statSync(destPath);
      progress(size, size);
    };
    for (const key of Object.keys(this.manifest.modules)) {
      const name = key as DesktopModuleName;
      if (this.isInstalled(name) || this.installing.has(name)) continue;
      const files = this.packFiles(name);
      if (
        files.length === 0 ||
        !files.every((file) => fs.existsSync(path.join(dir, file)))
      ) {
        continue;
      }
      try {
        await this.downloadAndInstallModule(name, onProgress, copyFromDir);
        installed.push(name);
      } catch (err: unknown) {
        failed.push({
          name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { installed, failed };
  }

  private async downloadAndInstallModule(
    name: DesktopModuleName,
    onProgress?: (p: ModuleProgress) => void,
    fetchFile: FileSource = (url, destPath, progress) =>
      this.downloadFile(url, destPath, progress)
  ): Promise<void> {
    const item = this.getManifestItem(name);
    if (!item) {
      throw new Error(`Module ${name} not found in manifest`);
    }

    const label = item.label?.vi || item.label?.en || name;
    const destDir = path.join(this.userModulesDir, name);
    const tmpDir = path.join(this.userModulesDir, '.tmp', name);
    // Built here and moved into place whole, so an install cut short (app
    // closed, download failed) never leaves a module that passes the probe
    // but lacks files.
    const stageDir = path.join(tmpDir, 'module');
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(stageDir, { recursive: true });

    try {
      if (item.kind === 'npm-tarball') {
        if (!item.url) throw new Error(`Missing url for module ${name}`);
        const tarPath = path.join(tmpDir, `${name}.tgz`);

        await fetchFile(item.url, tarPath, (received, total) => {
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
        await tar.x({
          file: tarPath,
          cwd: stageDir,
          strip: 1,
        });
      } else if (item.kind === 'files' && item.files) {
        let totalReceivedSoFar = 0;
        const totalSize = item.size || 0;

        for (const f of item.files) {
          const filePath = path.join(stageDir, f.path);
          fs.mkdirSync(path.dirname(filePath), { recursive: true });

          let currentFileReceived = 0;
          await fetchFile(f.url, filePath, (rec) => {
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
      if (!fs.existsSync(path.join(stageDir, item.probe))) {
        throw new Error(
          `Installation verification failed: probe file "${item.probe}" not found after extracting ${name}`
        );
      }

      fs.rmSync(destDir, { recursive: true, force: true });
      fs.renameSync(stageDir, destDir);
    } finally {
      // Clean up tmp dir
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }

  /**
   * A connection that stops sending data never ends a plain fetch, which
   * left the tool spinning forever. Abort once no data has arrived for
   * DOWNLOAD_STALL_MS, so the user gets an error and can try again.
   */
  private async downloadFile(
    url: string,
    destPath: string,
    onProgress: (received: number, total: number) => void
  ): Promise<void> {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const armStallTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(), DOWNLOAD_STALL_MS);
    };

    const fileStream = fs.createWriteStream(destPath);
    try {
      armStallTimer();
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok || !response.body) {
        throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
      }

      const contentLength = Number(
        response.headers.get('content-length') || '0'
      );
      let received = 0;
      const reader = response.body.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          armStallTimer();
          received += value.length;
          if (!fileStream.write(Buffer.from(value))) {
            await once(fileStream, 'drain');
          }
          onProgress(received, contentLength);
        }
      }
    } catch (err: unknown) {
      fileStream.destroy();
      if (controller.signal.aborted) {
        throw new Error(
          `Download stalled: no data for ${DOWNLOAD_STALL_MS / 1000}s from ${new URL(url).host}. Check the network connection and try again.`
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    await new Promise<void>((resolve, reject) => {
      fileStream.end((err: unknown) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}
