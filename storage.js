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

function getR2ConfigStatus() {
  return {
    endpoint: !!endpoint,
    accessKey: !!accessKey,
    secretKey: !!secretKey,
    bucketName: !!bucketName,
    endpointValue: endpoint || '(yok)',
    bucketValue: bucketName || '(yok)',
    configured: isR2Configured()
  };
}

// S3/R2 istemcisi - lazy initialization (env değişse de tekrar dener)
let _s3 = null;
let _s3Initialized = false;

function getS3Client() {
  if (_s3Initialized) return _s3;
  _s3Initialized = true;
  if (!isR2Configured()) {
    const status = getR2ConfigStatus();
    console.warn('⚠️ R2 yapılandırılmadı:', JSON.stringify(status));
    _s3 = null;
    return null;
  }
  try {
    const { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    const client = new S3Client({
      region: 'auto',
      endpoint: endpoint,
      credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
      forcePathStyle: false,
    });
    _s3 = { client, GetObjectCommand, PutObjectCommand, HeadObjectCommand, getSignedUrl };
    console.log(`✅ R2 istemcisi hazır → ${endpoint} / bucket: ${bucketName}`);
    return _s3;
  } catch (e) {
    console.error('⚠️ AWS S3 SDK yükleme hatası:', e.message);
    _s3 = null;
    return null;
  }
}

// Geriye uyumluluk için eski s3 değişkeni (lazy getter)
const s3 = (() => {
  // İlk çağrıda lazy init yap, Proxy gibi davran
  const handler = {
    get(target, prop) {
      const real = getS3Client();
      return real ? real[prop] : undefined;
    }
  };
  return new Proxy({}, handler);
})();

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
  const s3Client = getS3Client();
  if (!isR2Configured() || !s3Client) {
    console.error('❌ Cloudflare R2 yapılandırılmadığı için yükleme atlandı. Durum:', getR2ConfigStatus());
    return false;
  }
  try {
    if (!fs.existsSync(localFilePath)) {
      console.error('❌ Yüklenecek dosya bulunamadı:', localFilePath);
      return false;
    }
    const fileBuffer = fs.readFileSync(localFilePath);
    // Alternatif stream yöntemi de eklenebilir ama buffer en güvenli
    const cmd = new s3Client.PutObjectCommand({
      Bucket: bucketName,
      Key: fileKey,
      Body: fileBuffer,
      ContentType: 'application/zip'
    });
    await s3Client.client.send(cmd);
    console.log(`✅ Dosya başarıyla Cloudflare R2 Bucket'ına aktarıldı: ${fileKey} (${(fileBuffer.length/1024/1024).toFixed(2)} MB)`);
    return true;
  } catch (e) {
    console.error('❌ Cloudflare R2 yükleme hatası:', e.message, e.Code || '');
    return false;
  }
}

// R2'den dosyayı sunucu üzerinden güvenle çekme
async function fetchFileFromR2(fileKey) {
  const s3Client = getS3Client();
  if (!isR2Configured() || !s3Client) return null;
  try {
    const cmd = new s3Client.GetObjectCommand({ Bucket: bucketName, Key: fileKey });
    const response = await s3Client.client.send(cmd);
    return response.Body; // Stream / ByteArray
  } catch (e) {
    // NoSuchKey vs diğer hataları ayırt et
    if (e.name === 'NoSuchKey' || e.Code === 'NoSuchKey') {
      console.warn(`⚠️ R2'de dosya bulunamadı (${fileKey}):`, e.message);
    } else {
      console.error('❌ R2 Dosya İndirme Hatası:', e.message, e.Code || e.name || '');
    }
    return null;
  }
}

// R2 presigned URL oluştur (alternatif direkt indirme - opsiyonel)
async function getPresignedR2Url(fileKey, expiresInSeconds = 3600) {
  const s3Client = getS3Client();
  if (!isR2Configured() || !s3Client) return null;
  try {
    const cmd = new s3Client.GetObjectCommand({ Bucket: bucketName, Key: fileKey });
    const url = await s3Client.getSignedUrl(s3Client.client, cmd, { expiresIn: expiresInSeconds });
    return url;
  } catch (e) {
    console.error('❌ R2 Presigned URL hatası:', e.message);
    return null;
  }
}

// Güvenli yerel sunucu indirme adresi üretici (imzalı proxy)
function downloadUrl(game, reqHost) {
  const { exp, sig } = signToken(game.id);
  const base = reqHost ? reqHost.replace(/\/+$/, '') : '';
  return `${base}/indir/${game.id}?exp=${exp}&sig=${sig}`;
}

function filePath(fileKey) {
  // fileKey path traversal koruması
  const safeKey = path.basename(String(fileKey));
  return path.join(STORAGE_DIR, safeKey);
}

// R2 bağlantısını test et (admin paneli için)
async function testR2Connection() {
  const s3Client = getS3Client();
  if (!isR2Configured() || !s3Client) {
    return { ok: false, error: 'R2 yapılandırılmadı', status: getR2ConfigStatus() };
  }
  try {
    // ListObjectsV2 yerine HeadBucket mantığı: 1 dosya listele
    const { ListObjectsV2Command } = require('@aws-sdk/client-s3');
    const cmd = new ListObjectsV2Command({ Bucket: bucketName, MaxKeys: 1 });
    await s3Client.client.send(cmd);
    return { ok: true, bucket: bucketName, endpoint };
  } catch (e) {
    return { ok: false, error: e.message, code: e.Code || e.name };
  }
}

module.exports = { STORAGE_DIR, s3, getS3Client, isR2Configured, getR2ConfigStatus, uploadToR2, fetchFileFromR2, getPresignedR2Url, downloadUrl, verify, signToken, filePath, testR2Connection };