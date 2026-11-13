import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import prebuilds from '@u4/minicap-prebuilt';

export interface ScrcpyDownloadOptions {
  /**
   * Exact destination file path for the downloaded jar
   */
  destPath?: string;
  /**
   * Directory in which to save the downloaded jar
   */
  destDir?: string;
  /**
   * Overwrite existing file even if it already exists
   */
  force?: boolean;
  /**
   * Custom direct download URL
   */
  url?: string;
  /**
   * Request timeout in milliseconds (default: 60000)
   */
  timeoutMs?: number;
  /**
   * Progress callback
   */
  onProgress?: (downloaded: number, total: number | null) => void;
}

/**
 * Extract clean version string from version or GitHub release URL.
 * Supports:
 * - "3.0", "v3.0", "2.7", etc.
 * - "https://github.com/Genymobile/scrcpy/releases/tag/v3.0"
 * - "https://github.com/Genymobile/scrcpy/releases/tag/3.0"
 * - "https://github.com/Genymobile/scrcpy/releases/download/v3.0/scrcpy-server-v3.0"
 */
export function parseScrcpyVersion(versionOrUrl = '3.0'): { version: string; customUrl?: string } {
  const trimmed = versionOrUrl.trim();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    // Pure version number, strip leading 'v' if present
    const cleanVersion = trimmed.replace(/^v/i, '');
    return { version: cleanVersion };
  }

  // Handle GitHub tag URL: https://github.com/Genymobile/scrcpy/releases/tag/v3.0
  const tagMatch = trimmed.match(/\/releases\/tag\/v?([0-9]+(?:\.[0-9]+)+)/i);
  if (tagMatch) {
    return { version: tagMatch[1] };
  }

  // Handle GitHub download URL: https://github.com/Genymobile/scrcpy/releases/download/v3.0/scrcpy-server-v3.0
  const downloadMatch = trimmed.match(/\/releases\/download\/v?([0-9]+(?:\.[0-9]+)+)/i);
  if (downloadMatch) {
    return { version: downloadMatch[1], customUrl: trimmed };
  }

  // Generic URL, fallback default version 3.0
  return { version: '3.0', customUrl: trimmed };
}

function isWritableDir(dirPath: string): boolean {
  try {
    fs.accessSync(dirPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the user cache directory for scrcpy-server downloads.
 */
export function getUserScrcpyCacheDir(): string {
  const xdgCache = process.env.XDG_CACHE_HOME;
  const cacheBase = xdgCache && xdgCache.length > 0
    ? xdgCache
    : path.join(os.homedir() || os.tmpdir(), '.cache');
  return path.join(cacheBase, '@u4', 'adbkit', 'scrcpy');
}

/**
 * Determine default destination file path for a given version.
 */
export function getDefaultScrcpyJarPath(version: string): string {
  // First preference: see if @u4/minicap-prebuilt path already exists or its directory is writable
  try {
    const prebuiltPath = prebuilds.getScrcpyJar(version);
    const parentDir = path.dirname(prebuiltPath);
    if (fs.existsSync(prebuiltPath) || (fs.existsSync(parentDir) && isWritableDir(parentDir))) {
      return prebuiltPath;
    }
  } catch {
    // ignore
  }

  // Fallback: user cache directory ($XDG_CACHE_HOME or ~/.cache/@u4/adbkit/scrcpy)
  return path.join(getUserScrcpyCacheDir(), `scrcpy-server-v${version}.jar`);
}

/**
 * Download scrcpy-server binary from GitHub releases.
 * Default release page: https://github.com/Genymobile/scrcpy/releases/tag/v3.0
 * Direct asset URL: https://github.com/Genymobile/scrcpy/releases/download/v3.0/scrcpy-server-v3.0
 *
 * @param versionOrUrl Version string (e.g. "3.0") or release URL (e.g. "https://github.com/Genymobile/scrcpy/releases/tag/v3.0")
 * @param options Download options (destination path/dir, force, onProgress)
 * @returns Absolute path to downloaded jar file
 */
export async function downloadScrcpyServer(
  versionOrUrl = '3.0',
  options: ScrcpyDownloadOptions = {}
): Promise<string> {
  const { version, customUrl } = parseScrcpyVersion(versionOrUrl);

  let targetPath: string;
  if (options.destPath) {
    targetPath = path.resolve(options.destPath);
  } else if (options.destDir) {
    targetPath = path.resolve(options.destDir, `scrcpy-server-v${version}.jar`);
  } else {
    targetPath = getDefaultScrcpyJarPath(version);
  }

  // If already exists and force is false, return existing path
  if (!options.force && fs.existsSync(targetPath)) {
    const stat = await fs.promises.stat(targetPath).catch(() => null);
    if (stat && stat.size > 0) {
      return targetPath;
    }
  }

  // Candidates for download URLs
  const candidateUrls: string[] = [];
  if (options.url) {
    candidateUrls.push(options.url);
  } else if (customUrl) {
    candidateUrls.push(customUrl);
  } else {
    // Scrcpy v2+ naming: scrcpy-server-vX.Y
    candidateUrls.push(`https://github.com/Genymobile/scrcpy/releases/download/v${version}/scrcpy-server-v${version}`);
    // Fallback: scrcpy-server-vX.Y.jar
    candidateUrls.push(`https://github.com/Genymobile/scrcpy/releases/download/v${version}/scrcpy-server-v${version}.jar`);
    // Fallback without v prefix in asset
    candidateUrls.push(`https://github.com/Genymobile/scrcpy/releases/download/v${version}/scrcpy-server-${version}.jar`);
  }

  let lastError: Error | null = null;
  const targetDir = path.dirname(targetPath);
  await fs.promises.mkdir(targetDir, { recursive: true });
  const tmpPath = `${targetPath}.tmp.${Date.now()}`;
  const timeoutMs = options.timeoutMs ?? 60_000;

  for (const url of candidateUrls) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        lastError = new Error(`Failed to download scrcpy-server from ${url}: HTTP ${response.status} ${response.statusText}`);
        continue;
      }

      if (!response.body) {
        lastError = new Error(`Empty response body from ${url}`);
        continue;
      }

      const contentLengthHeader = response.headers.get('content-length');
      const totalBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : null;
      let downloadedBytes = 0;

      const bodyStream = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>);
      const fileStream = fs.createWriteStream(tmpPath);

      if (options.onProgress) {
        const onProgress = options.onProgress;
        const progressStream = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            downloadedBytes += chunk.byteLength;
            onProgress(downloadedBytes, totalBytes);
            callback(null, chunk);
          },
        });
        await pipeline(bodyStream, progressStream, fileStream);
      } else {
        await pipeline(bodyStream, fileStream);
      }

      // Verify downloaded file is not empty
      const stat = await fs.promises.stat(tmpPath).catch(() => null);
      if (!stat || stat.size === 0) {
        await fs.promises.unlink(tmpPath).catch(() => {});
        lastError = new Error(`Downloaded file from ${url} was empty`);
        continue;
      }

      // Rename tmp to target
      await fs.promises.rename(tmpPath, targetPath);
      return targetPath;
    } catch (err: unknown) {
      await fs.promises.unlink(tmpPath).catch(() => {});
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError || new Error(`Unable to download scrcpy-server v${version}`);
}

