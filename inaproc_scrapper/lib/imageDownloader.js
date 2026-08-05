"use strict";

const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");
const { withRetry } = require("./retry");

function guessExtension(url) {
  const clean = url.split("?")[0].split("#")[0];
  const ext = path.extname(clean).toLowerCase();
  if (ext && ext.length <= 5) return ext;
  return ".jpg"; // sensible default when the URL has no extension
}

/**
 * Downloads a single image to destDir, named `${fileNameBase}${ext}`.
 * Skips the download if a matching file already exists, so re-running the
 * script after a partial failure doesn't redo completed work.
 * Returns the local file path (absolute) on success, or null on failure.
 */
async function downloadImage(url, destDir, fileNameBase, label) {
  const ext = guessExtension(url);
  const fileName = `${fileNameBase}${ext}`;
  const destPath = path.join(destDir, fileName);

  if (fs.existsSync(destPath) && fs.statSync(destPath).size > 0) {
    return destPath;
  }

  try {
    await withRetry(async () => {
      const res = await fetch(url, {
        headers: {
          accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        },
      });
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      fs.mkdirSync(destDir, { recursive: true });
      const tmpPath = `${destPath}.part`;
      await pipeline(res.body, fs.createWriteStream(tmpPath));
      fs.renameSync(tmpPath, destPath);
    }, label || `image ${fileName}`);
    return destPath;
  } catch (err) {
    console.warn(`  ! Giving up on image ${fileNameBase} for ${label || ""}: ${err.message}`);
    return null;
  }
}

module.exports = { downloadImage };
