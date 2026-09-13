const path = require('path');
const { Pool } = require('pg');

cat > /home/workdir/artifacts/townhall-live/townhall/server/db.js << 'EOF'
const { Pool } = require('pg');

/**
 * Render provides DATABASE_URL.
 * Local/Docker can use discrete DB_* vars.
 */
function buildPoolConfig() {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl:
        process.env.DB_SSL === 'false'
          ? false
          : { rejectUnauthorized: false },
    };
  }

  const rawPwd = process.env.DB_PASSWORD;
  const password = (typeof rawPwd === 'string' ? rawPwd : String(rawPwd || '')).trim();

  if (!password) {
    console.error('CRITICAL: Set DATABASE_URL or DB_PASSWORD');
    process.exit(1);
  }

  console.log('DB Password loaded:', { type: typeof password, length: password.length });

  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    database: process.env.DB_NAME || 'townhall',
    user: process.env.DB_USER || 'postgres',
    password,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  };
}

const pool = new Pool(buildPoolConfig());

pool.connect((err, client, release) => {
  if (err) {
    console.error('PostgreSQL connection error:', err.message);
  } else {
    console.log('Connected to PostgreSQL');
    release();
  }
});

module.exports = pool;
EOF

