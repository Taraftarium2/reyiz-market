const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const STORAGE_DIR = (process.env.STORAGE_DIR && String(process.env.STORAGE_DIR).trim() !== '')
  ? path.resolve(process.env.STORAGE_DIR)
  : path.join(__dirname, 'storage');
const SIGN_SECRET = process.env.SIGN_SECRET || process.env.JWT_SECRET || 'signed-url-secret';
const DOWNLOAD_TTL_MS = 10 * 60 * 1000; // 10 dakika geçerli

const accessKey = process.env.R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY;
const secretKey = process.env.R2_SECRET_ACCESS_KEY || process.env.R2_SECRET_KEY;
const bucketName = process.env.R2_BUCKET_NAME || process.env.R2_BUCKET;
const endpoint = process.env.R2_ENDPOINT;

function isR2Configured() {
  return !!(endpoint && accessKey && secretKey && bucketName);
}

// S3/R2 istemcisi
const s3 = isR2Configured()
  ? (() => {
      try {
        const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
        const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
        const client = new S3Client({
          region: 'auto',
          endpoint: endpoint,
          credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
        });
        return { client, GetObjectCommand, getSignedUrl };
      } catch (e) {
        console.error('⚠️ AWS S3 SDK yükleme uyarısı:', e.message);
        return null;
      }
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

async function getR2SignedUrl(fileKey) {
  if (!s3 || !bucketName) return null;
  try {
    const cmd = new s3.GetObjectCommand({ Bucket: bucketName, Key: fileKey });
    const url = await s3.getSignedUrl(s3.client, cmd, { expiresIn: 600 });
    return url;
  } catch (e) {
    console.error('Cloudflare R2 imzalı URL oluşturma hatası:', e.message);
    return null;
  }
}

// Local veya R2 modunda çalışan downloadUrl üretici
async function downloadUrl(game, reqHost) {
  if (isR2Configured()) {
    const r2Url = await getR2SignedUrl(game.file_key);
    if (r2Url) return r2Url;
  }
  const { exp, sig } = signToken(game.id);
  return `${reqHost || ''}/indir/${game.id}?exp=${exp}&sig=${sig}`;
}

function filePath(fileKey) {
  return path.join(STORAGE_DIR, fileKey);
}

module.exports = { STORAGE_DIR, s3, isR2Configured, getR2SignedUrl, downloadUrl, verify, signToken, filePath };