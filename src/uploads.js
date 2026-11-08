// Product image uploads: memory-buffered, size-limited, validated by file signature (never by
// the client's filename or MIME type), saved under a random name outside the public folder.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'data', 'uploads');
const MAX_BYTES = 3 * 1024 * 1024;
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const parser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1, fields: 24, fieldSize: 20 * 1024 },
});

/** Identify JPEG / PNG / WebP from the first bytes. SVG and everything else is refused. */
function sniff(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/**
 * Express middleware: parses an optional multipart "image" field.
 * Problems are reported on req.uploadError so the route can re-render the form.
 */
function acceptImage(req, res, next) {
  parser.single('image')(req, res, (err) => {
    if (err) {
      req.uploadError = err.code === 'LIMIT_FILE_SIZE'
        ? `The image is too large. Please keep it under ${MAX_BYTES / 1024 / 1024} MB.`
        : 'The upload could not be read. Please try again.';
    } else if (req.file && req.file.size > 0) {
      const type = sniff(req.file.buffer);
      if (type) req.file.detectedExt = type;
      else req.uploadError = 'Only JPG, PNG or WebP images are allowed.';
    } else {
      req.file = undefined; // empty file input
    }
    next();
  });
}

/** Write the validated upload to disk and return its stored filename. */
function saveImage(file) {
  const name = `${crypto.randomUUID()}.${file.detectedExt}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), file.buffer, { flag: 'wx' });
  return name;
}

const SAFE_NAME = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;

function deleteImage(name) {
  if (!name || !SAFE_NAME.test(name)) return;
  try { fs.unlinkSync(path.join(UPLOAD_DIR, name)); } catch { /* already gone */ }
}

module.exports = { UPLOAD_DIR, MAX_BYTES, acceptImage, saveImage, deleteImage };
