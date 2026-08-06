const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const STORAGE_DIR = (process.env.STORAGE_DIR && String(process.env.STORAGE_DIR).trim() !== '')
  ? path.resolve(process.env.STORAGE_DIR)
  : path.join(__dirname, 'storage');
const SIGN_SECRET = process.env.SIGN_SECRET || process.env.JWT_SECRET || 'signed-url-secret';
const DOWNLOAD_TTL_MS = 24 * 60 * 60 * 1000; // 24 saat geçerli

const accessKey = process.env.R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY;
const secretKey = process.env.R2_SECRET_ACCESS_KEY || process.env.R2_SECRET_KEY;
const bucketName = process.env.R2_BUCKET_NAME || process.env.R2_BUCKET;
let endpoint = process.env.R2_ENDPOINT;

// Endpoint başında https:// yoksa ekle, sonunda / varsa temizle
if (endpoint) {
  endpoint = endpoint.trim();
  if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
    endpoint = 'https://' + endpoint;
  }
  endpoint = endpoint.replace(/\/+$/, '');
}

function isR2Configured() {
  return !!(endpoint && accessKey && secretKey && bucketName);
}

// S3/R2 istemcisi
const s3 = isR2Configured()
  ? (() => {
      try {
        const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
        const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
        const client = new S3Client({
          region: 'auto',
          endpoint: endpoint,
          credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
        });
        return { client, GetObjectCommand, PutObjectCommand, getSignedUrl };
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

async function uploadToR2(fileKey, localFilePath) {
  if (!isR2Configured() || !s3) {
    console.error('❌ Cloudflare R2 yapılandırılmadığı için yükleme atlandı. isR2Configured:', isR2Configured());
    return false;
  }
  try {
    const fileBuffer = fs.readFileSync(localFilePath);
    const cmd = new s3.PutObjectCommand({
      Bucket: bucketName,
      Key: fileKey,
      Body: fileBuffer,
      ContentType: 'application/zip'
    });
    await s3.client.send(cmd);
    console.log(`✅ Dosya başarıyla Cloudflare R2 Bucket'ına aktarıldı: ${fileKey}`);
    return true;
  } catch (e) {
    console.error('❌ Cloudflare R2 yükleme hatası:', e.message);
    return false;
  }
}

// R2'den dosyayı sunucu üzerinden güvenle çekme
async function fetchFileFromR2(fileKey) {
  if (!isR2Configured() || !s3) return null;
  try {
    const cmd = new s3.GetObjectCommand({ Bucket: bucketName, Key: fileKey });
    const response = await s3.client.send(cmd);
    return response.Body; // Stream / ByteArray
  } catch (e) {
    console.error('❌ R2 Dosya İndirme Hatası:', e.message);
    return null;
  }
}

// Güvenli yerel sunucu indirme adresi üretici
function downloadUrl(game, reqHost) {
  const { exp, sig } = signToken(game.id);
  const base = reqHost ? reqHost.replace(/\/+$/, '') : '';
  return `${base}/indir/${game.id}?exp=${exp}&sig=${sig}`;
}

function filePath(fileKey) {
  return path.join(STORAGE_DIR, fileKey);
}

module.exports = { STORAGE_DIR, s3, isR2Configured, uploadToR2, fetchFileFromR2, downloadUrl, verify, signToken, filePath };