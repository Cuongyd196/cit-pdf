/**
 * Picks the Windows installer out of a GitHub release, for "Update and
 * restart". Kept free of Electron imports so it can be unit-tested.
 */

export interface ReleaseInstaller {
  name: string;
  url: string;
  size: number;
  /** Lowercase hex. */
  sha256: string;
}

interface ReleaseAsset {
  name?: unknown;
  browser_download_url?: unknown;
  size?: unknown;
  /** "sha256:<hex>", given by GitHub for newer uploads. */
  digest?: unknown;
}

const INSTALLER_NAME = /^CIT-PDF-[\w.-]+-Windows-x64-Setup\.exe$/;
const HEX_64 = /^[0-9a-f]{64}$/;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The release's Setup.exe and its SHA-256: from the asset's digest, else
 * from the release notes ("`<name>`: `<hex>`", as each release lists them).
 * Null when there is no installer from our releases or no hash to check it
 * with: the app then sends the user to the download page instead.
 */
export function findInstaller(
  release: { assets?: unknown; body?: unknown },
  downloadPrefix: string
): ReleaseInstaller | null {
  const assets = Array.isArray(release.assets)
    ? (release.assets as ReleaseAsset[])
    : [];
  const asset = assets.find(
    (a) => typeof a.name === 'string' && INSTALLER_NAME.test(a.name)
  );
  if (!asset) return null;
  const name = asset.name as string;
  const url = asset.browser_download_url;
  if (typeof url !== 'string' || !url.startsWith(downloadPrefix)) return null;

  let sha256 = '';
  if (typeof asset.digest === 'string' && asset.digest.startsWith('sha256:')) {
    sha256 = asset.digest.slice('sha256:'.length).toLowerCase();
  } else if (typeof release.body === 'string') {
    const match = new RegExp(
      `${escapeRegExp(name)}\`?\\s*[:：]\\s*\`?([0-9a-fA-F]{64})`
    ).exec(release.body);
    if (match) sha256 = match[1].toLowerCase();
  }
  if (!HEX_64.test(sha256)) return null;

  return {
    name,
    url,
    size: typeof asset.size === 'number' ? asset.size : 0,
    sha256,
  };
}
