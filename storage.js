const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const STORAGE_DIR = process.env.STORAGE_DIR || path.join(__dirname, 'storage');
const SIGN_SECRET = process.env.SIGN_SECRET || process.env.JWT_SECRET || 'signed-url-secret';
const DOWNLOAD_TTL_MS = 10 * 60 * 1000; // 10 dakika geçerli

// S3/R2 istemcisi — anahtarlar eksikse null kalır ve local mod kullanılır
const s3 =
  process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY && process.env.R2_SECRET_KEY && process.env.R2_BUCKET
    ? (() => {
        const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
        const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
        const client = new S3Client({
          region: 'auto',
          endpoint: process.env.R2_ENDPOINT,
          credentials: { accessKeyId: process.env.R2_ACCESS_KEY, secretAccessKey: process.env.R2_SECRET_KEY },
        });
        return { client, GetObjectCommand, getSignedUrl };
      })()
    : null;

function signToken(gameId) {
  const exp = Date.now() + DOWNLOAD_TTL_MS;
  const sig = crypto.createHmac('sha256', SIGN_SECRET).update(`${gameId}:${exp}`).digest('hex');
  return { exp, sig };
}

function verify(gameId, exp, sig) {
  if (!exp || !sig) return false;
  if (Date.now() > Number(exp)) return false;
  const expected = crypto.createHmac('sha256', SIGN_SECRET).update(`${gameId}:${exp}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(sig));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Local mod: uygulama üzerinden imzalı indirme linki
// R2 modu: S3 presigned URL döner
function downloadUrl(game, reqHost) {
  if (s3) {
    const cmd = new s3.GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: game.file_key });
    return s3.getSignedUrl(s3.client, cmd, { expiresIn: 600 });
  }
  const { exp, sig } = signToken(game.id);
  return `${reqHost}/indir/${game.id}?exp=${exp}&sig=${sig}`;
}

function filePath(fileKey) {
  return path.join(STORAGE_DIR, fileKey);
}

module.exports = { STORAGE_DIR, s3, downloadUrl, verify, signToken, filePath };