import { describe, expect, it } from 'vitest';
import { findInstaller } from '../../desktop/src/release-installer';

const PREFIX = 'https://github.com/Cuongyd196/cit-pdf/releases/download/';
const HASH = 'a'.repeat(64);
const setup = (extra: Record<string, unknown> = {}) => ({
  name: 'CIT-PDF-1.0.6-Windows-x64-Setup.exe',
  browser_download_url: `${PREFIX}1.0.6/CIT-PDF-1.0.6-Windows-x64-Setup.exe`,
  size: 144_000_000,
  ...extra,
});
const portable = {
  name: 'CIT-PDF-1.0.6-Windows-x64-Portable.exe',
  browser_download_url: `${PREFIX}1.0.6/CIT-PDF-1.0.6-Windows-x64-Portable.exe`,
};

describe('findInstaller', () => {
  it('takes the hash from the release notes', () => {
    const body = `**SHA-256**\n- \`CIT-PDF-1.0.6-Windows-x64-Setup.exe\`: \`${HASH.toUpperCase()}\`\n- \`CIT-PDF-1.0.6-Windows-x64-Portable.exe\`: \`${'b'.repeat(64)}\``;
    expect(
      findInstaller({ assets: [portable, setup()], body }, PREFIX)
    ).toEqual({
      name: 'CIT-PDF-1.0.6-Windows-x64-Setup.exe',
      url: `${PREFIX}1.0.6/CIT-PDF-1.0.6-Windows-x64-Setup.exe`,
      size: 144_000_000,
      sha256: HASH,
    });
  });

  it("prefers GitHub's own digest", () => {
    const found = findInstaller(
      { assets: [setup({ digest: `sha256:${'c'.repeat(64)}` })], body: '' },
      PREFIX
    );
    expect(found?.sha256).toBe('c'.repeat(64));
  });

  it('gives up without a hash to check against', () => {
    expect(findInstaller({ assets: [setup()], body: 'notes' }, PREFIX)).toBe(
      null
    );
  });

  it('only takes installers from our releases', () => {
    const elsewhere = setup({
      browser_download_url: 'https://example.com/CIT-PDF-1.0.6-Windows-x64-Setup.exe',
      digest: `sha256:${HASH}`,
    });
    expect(findInstaller({ assets: [elsewhere] }, PREFIX)).toBe(null);
    expect(
      findInstaller({ assets: [{ ...portable, digest: `sha256:${HASH}` }] }, PREFIX)
    ).toBe(null);
  });
});
