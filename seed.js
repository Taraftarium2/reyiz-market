require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { STORAGE_DIR } = require('./storage');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

async function main() {
  const targetStorageDir = (STORAGE_DIR && String(STORAGE_DIR).trim() !== '') ? STORAGE_DIR : path.join(__dirname, 'storage');
  if (!fs.existsSync(targetStorageDir)) {
    try { fs.mkdirSync(targetStorageDir, { recursive: true }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  await db.query(schema);

  // Admin hesabı
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@reyizmarket.click';
  const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
  const existingAdmin = await db.query('SELECT id FROM users WHERE email=$1', [adminEmail]);
  if (!existingAdmin.rows.length) {
    await db.query('INSERT INTO users (email,password_hash,name,role) VALUES ($1,$2,$3,$4)',
      [adminEmail, await bcrypt.hash(adminPass, 10), 'Admin', 'admin']);
    console.log('✅ Admin oluşturuldu:', adminEmail);
  }

  // Örnek oyunlar
  const sample = [
    { title: 'Ne Çizdim?', slug: 'ne-cizdim', price: 149, tag: 'Çizim', featured: true, desc: 'İzleyiciler çizimi tahmin eder, yayıncı canlı puan verir.' },
    { title: 'Kelime Savaşı', slug: 'kelime-savasi', price: 199, tag: 'Quiz', featured: true, desc: 'Kelime üretme tabanlı hızlı mini oyun.' },
    { title: 'Bil Bakalım', slug: 'bil-bakalim', price: 99, tag: 'Tahmin', featured: false, desc: 'Basit ve eğlenceli tahmin oyunu.' },
    { title: 'Hızlı Tahmin', slug: 'hizli-tahmin', price: 129, tag: 'Tahmin', featured: false, desc: 'Saniyede skor topla, liderlik tablosunda yarış.' },
    { title: 'Mini Race', slug: 'mini-race', price: 299, tag: 'Aksiyon', featured: true, desc: '2D mini yarış oyunu, TikTok oyları hıza dönüşür.' },
    { title: 'Trivia Şov', slug: 'trivia-sov', price: 179, tag: 'Quiz', featured: false, desc: 'Canlı yayın trivia şovu.' },
  ];

  for (const s of sample) {
    const found = await db.query('SELECT id FROM games WHERE slug=$1', [s.slug]);
    if (found.rows.length) continue;
    const fkey = 'game_' + s.slug + '.zip';
    fs.writeFileSync(
      path.join(STORAGE_DIR, fkey),
      'REYIZ MARKET — yer tutucu oyun dosyası.\nGerçek Node.js oyun paketini admin panelinden yükleyin: ' + s.slug + '\n'
    );
    await db.query(
      'INSERT INTO games (title,slug,description,price,file_key,node_version,tag,featured) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [s.title, s.slug, s.desc, s.price, fkey, '18', s.tag, s.featured]
    );
  }

  console.log('✅ Tablolar kuruldu, örnek oyunlar eklendi. Hazır!');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });