CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS games (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  cover_image_url TEXT,
  file_key TEXT NOT NULL,
  node_version TEXT DEFAULT '18',
  tag TEXT DEFAULT 'Mini Oyun',
  featured BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  total_amount NUMERIC(10,2),
  status TEXT DEFAULT 'pending',
  payment_provider TEXT,
  payment_ref TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INT REFERENCES orders(id),
  game_id INT REFERENCES games(id),
  price_at_purchase NUMERIC(10,2)
);

CREATE TABLE IF NOT EXISTS user_library (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  game_id INT REFERENCES games(id),
  purchased_at TIMESTAMPTZ DEFAULT now(),
  download_count INT DEFAULT 0,
  UNIQUE (user_id, game_id)
);