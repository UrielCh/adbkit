import fs from 'node:fs';
import path from 'node:path';
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

/**
 * Determine default destination file path for a given version.
 */
export function getDefaultScrcpyJarPath(version: string): string {
  // First preference: see if @u4/minicap-prebuilt path can be resolved
  try {
    const prebuiltPath = prebuilds.getScrcpyJar(version);
    const parentDir = path.dirname(prebuiltPath);
    if (fs.existsSync(parentDir)) {
      return prebuiltPath;
    }
  } catch {
    // ignore
  }

  // Second preference: workspace/local prebuilt folder
  return path.resolve(process.cwd(), 'prebuilt', 'scrcpy', `scrcpy-server-v${version}.jar`);
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

  for (const url of candidateUrls) {
    try {
      const response = await fetch(url, { redirect: 'follow' });
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

      const fileStream = fs.createWriteStream(tmpPath);
      // Read chunks from web stream
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          fileStream.write(Buffer.from(value));
          downloadedBytes += value.byteLength;
          if (options.onProgress) {
            options.onProgress(downloadedBytes, totalBytes);
          }
        }
      }

      await new Promise<void>((resolve, reject) => {
        fileStream.end((err?: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      });

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
    } catch (err: any) {
      await fs.promises.unlink(tmpPath).catch(() => {});
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError || new Error(`Unable to download scrcpy-server v${version}`);
}

