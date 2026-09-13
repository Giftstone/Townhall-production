/**
 * Comprehensive seed script for Townhall
 * Creates wards, admin, responders, citizens, sample reports & polls
 *
 * Run:  node scripts/seed.js
 * (from the server/ directory, with DB running)
 */

require('dotenv').config();
const pool = require('../db');
const bcrypt = require('bcryptjs');

const DEFAULT_PASSWORD = 'Password123!'; // same for all seeded users for easy testing

async function seed() {
  let client;
  try {
    client = await pool.connect();
  } catch (err) {
    console.error('❌ Could not connect to the database.');
    console.error(`   Host: ${process.env.DB_HOST || 'localhost'}`);
    console.error(`   User: ${process.env.DB_USER || 'postgres'}`);
    console.error(`   DB:   ${process.env.DB_NAME || 'townhall'}`);
    console.error(`   Error: ${err.message}`);
    if (err.code === '28P01') {
      console.error('\n   Password does not match the existing Postgres volume.');
      console.error('   Postgres only stores the password on FIRST start.');
      console.error('   Fix (keep data): put the ORIGINAL password in .env as POSTGRES_PASSWORD');
      console.error('                    then: docker compose up -d --force-recreate');
      console.error('   Fix (wipe DB):   docker compose down -v && docker compose up -d --build');
    }
    process.exit(1);
  }

  try {
    await client.query('BEGIN');

    console.log('🌱 Starting database seed...\n');

    // -------------------------------------------------
    // 1. WARDS
    // -------------------------------------------------
    console.log('📍 Seeding wards...');
    await client.query(`
      INSERT INTO wards (id, name, deficit_index) VALUES
        (1, 'Ward 1 - Central Business District', 8.5),
        (2, 'Ward 2 - Industrial Zone', 9.2),
        (3, 'Ward 3 - Riverside', 6.8),
        (4, 'Ward 4 - Northern Suburbs', 5.4),
        (5, 'Ward 5 - Eastern Township', 9.7)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        deficit_index = EXCLUDED.deficit_index;
    `);
    // Reset sequence so future inserts don't collide
    await client.query(`SELECT setval('wards_id_seq', (SELECT MAX(id) FROM wards));`);
    console.log('   ✅ 5 wards created\n');

    // -------------------------------------------------
    // 2. USERS
    // -------------------------------------------------
    console.log('👥 Seeding users...');
    const hashed = await bcrypt.hash(DEFAULT_PASSWORD, 10);

    const users = [
      // Administrator
      { name: 'System Admin',       email: 'admin@townhall.com',      role: 'administrator', ward_id: 1 },

      // Emergency Responders
      { name: 'Chanda Banda',       email: 'chanda.banda@townhall.com',   role: 'responder', ward_id: 1 },
      { name: 'Thandiwe Phiri',     email: 'thandiwe.phiri@townhall.com', role: 'responder', ward_id: 2 },
      { name: 'Musa Tembo',         email: 'musa.tembo@townhall.com',     role: 'responder', ward_id: 3 },
      { name: 'Grace Mulenga',      email: 'grace.mulenga@townhall.com',  role: 'responder', ward_id: 5 },

      // Citizens
      { name: 'John Mwanza',        email: 'john.mwanza@email.com',       role: 'citizen', ward_id: 1 },
      { name: 'Mary Kabwe',         email: 'mary.kabwe@email.com',        role: 'citizen', ward_id: 1 },
      { name: 'David Mulenga',      email: 'david.mulenga@email.com',     role: 'citizen', ward_id: 2 },
      { name: 'Ruth Bwalya',        email: 'ruth.bwalya@email.com',       role: 'citizen', ward_id: 2 },
      { name: 'Peter Zulu',         email: 'peter.zulu@email.com',        role: 'citizen', ward_id: 3 },
      { name: 'Grace Phiri',        email: 'grace.phiri@email.com',       role: 'citizen', ward_id: 3 },
      { name: 'Joseph Sakala',      email: 'joseph.sakala@email.com',     role: 'citizen', ward_id: 4 },
      { name: 'Esther Mwila',       email: 'esther.mwila@email.com',      role: 'citizen', ward_id: 4 },
      { name: 'Daniel Chanda',      email: 'daniel.chanda@email.com',     role: 'citizen', ward_id: 5 },
      { name: 'Joyce Banda',        email: 'joyce.banda@email.com',       role: 'citizen', ward_id: 5 },
    ];

    const userIds = {};

    for (const u of users) {
      const res = await client.query(
        `INSERT INTO users (name, email, password_hash, role, ward_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email) DO UPDATE SET
           name = EXCLUDED.name,
           password_hash = EXCLUDED.password_hash,
           role = EXCLUDED.role,
           ward_id = EXCLUDED.ward_id
         RETURNING id, email, role`,
        [u.name, u.email, hashed, u.role, u.ward_id]
      );
      userIds[u.email] = res.rows[0].id;
      console.log(`   ✅ ${u.role.padEnd(14)} ${u.email}`);
    }
    console.log('');

    // -------------------------------------------------
    // 3. SAMPLE REPORTS
    // -------------------------------------------------
    console.log('📋 Seeding sample reports...');
    const reports = [
      {
        title: 'Large pothole on Independence Avenue',
        description: 'Deep pothole near the market entrance damaging vehicles daily.',
        category: 'Infrastructure',
        status: 'pending',
        location: 'Independence Ave, Ward 1',
        lat: -12.9680, lng: 28.6330,
        user_email: 'john.mwanza@email.com',
      },
      {
        title: 'Broken street lights – dark stretch',
        description: 'Street lights not working for 2 weeks. Safety concern at night.',
        category: 'Safety',
        status: 'pending',
        location: 'Industrial Road, Ward 2',
        lat: -12.9750, lng: 28.6400,
        user_email: 'david.mulenga@email.com',
        assigned_to: 'thandiwe.phiri@townhall.com',
      },
      {
        title: 'Water pipe burst flooding road',
        description: 'Major leak near the primary school. Road is impassable.',
        category: 'Water',
        status: 'in_progress',
        location: 'Riverside Primary, Ward 3',
        lat: -12.9600, lng: 28.6200,
        user_email: 'peter.zulu@email.com',
        assigned_to: 'musa.tembo@townhall.com',
      },
      {
        title: 'Illegal dumping site growing',
        description: 'Residents dumping refuse behind the shops. Health hazard.',
        category: 'Sanitation',
        status: 'pending',
        location: 'Eastern Market, Ward 5',
        lat: -12.9800, lng: 28.6500,
        user_email: 'daniel.chanda@email.com',
      },
      {
        title: 'Clinic short of essential medicines',
        description: 'Community clinic has run out of basic antibiotics and malaria drugs.',
        category: 'Health',
        status: 'resolved',
        location: 'Northern Clinic, Ward 4',
        lat: -12.9500, lng: 28.6100,
        user_email: 'esther.mwila@email.com',
        assigned_to: 'grace.mulenga@townhall.com',
      },
    ];

    for (const r of reports) {
      await client.query(
        `INSERT INTO reports
           (title, description, category, status, location, latitude, longitude, user_id, assigned_to)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          r.title,
          r.description,
          r.category,
          r.status,
          r.location,
          r.lat,
          r.lng,
          userIds[r.user_email],
          r.assigned_to ? userIds[r.assigned_to] : null,
        ]
      );
    }
    console.log(`   ✅ ${reports.length} reports created\n`);

    // -------------------------------------------------
    // 4. SAMPLE POLLS + VOTES
    // -------------------------------------------------
    console.log('🗳️  Seeding polls and votes...');
    const polls = [
      {
        category: 'roads',
        description: 'Should the main market road be prioritised for resurfacing this quarter?',
        options: ['Yes – urgent', 'Yes – but schedule later', 'No – other priorities first'],
        ward_id: 1,
      },
      {
        category: 'water',
        description: 'Which solution do you prefer for the recurring water shortages?',
        options: ['New borehole', 'Fix existing pipes', 'Water tankers temporarily'],
        ward_id: 3,
      },
      {
        category: 'security',
        description: 'Do you support increased night patrols in the industrial area?',
        options: ['Strongly support', 'Support', 'Neutral', 'Oppose'],
        ward_id: 2,
      },
      {
        category: 'healthcare',
        description: 'What is the biggest need at the community clinic?',
        options: ['More staff', 'More medicines', 'Better equipment', 'Longer opening hours'],
        ward_id: 5,
      },
    ];

    for (const p of polls) {
      const pollRes = await client.query(
        `INSERT INTO polls (category, description, options, ward_id, status)
         VALUES ($1, $2, $3, $4, 'open')
         RETURNING id`,
        [p.category, p.description, p.options, p.ward_id]
      );
      const pollId = pollRes.rows[0].id;

      // Add a few anonymous votes (hash = simple unique string for seed)
      for (let i = 0; i < 5 + Math.floor(Math.random() * 8); i++) {
        const hash = `seed_${pollId}_${i}_${Date.now()}`;
        await client.query(
          `INSERT INTO votes (poll_id, vote_hash, option_index)
           VALUES ($1, $2, $3)`,
          [pollId, hash, Math.floor(Math.random() * p.options.length)]
        );
      }
    }
    console.log(`   ✅ ${polls.length} polls + sample votes created\n`);

    // -------------------------------------------------
    // DONE
    // -------------------------------------------------
    await client.query('COMMIT');

    console.log('══════════════════════════════════════════');
    console.log('🎉 Seed completed successfully!');
    console.log('══════════════════════════════════════════');
    console.log('\nLogin credentials (password for ALL users):');
    console.log(`   Password:  ${DEFAULT_PASSWORD}\n`);
    console.log('Administrator:');
    console.log('   admin@townhall.com\n');
    console.log('Responders:');
    console.log('   chanda.banda@townhall.com');
    console.log('   thandiwe.phiri@townhall.com');
    console.log('   musa.tembo@townhall.com');
    console.log('   grace.mulenga@townhall.com\n');
    console.log('Citizens (examples):');
    console.log('   john.mwanza@email.com');
    console.log('   mary.kabwe@email.com');
    console.log('   ... (10 citizens total)\n');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seed failed:', err.message);
    console.error(err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
