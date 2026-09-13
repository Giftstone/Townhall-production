/**
 * Comprehensive seed script for Townhall
 * Creates wards, admin, responders, citizens, Zambia-specific reports & polls
 *
 * Run:  node scripts/seed.js
 * ( DB running)
 */

require('dotenv').config();
const pool = require('../db');
const bcrypt = require('bcryptjs');

const DEFAULT_PASSWORD = 'Password123!';

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
    process.exit(1);
  }

  try {
    await client.query('BEGIN');
    console.log('🌱 Starting database seed...\n');

    // ─── 1. WARDS ────────────────────────────────────────────────────────────
    console.log('📍 Seeding wards...');
    await client.query(`
      INSERT INTO wards (id, name, deficit_index) VALUES
        (1, 'Ward 1 - Central Business District', 8.5),
        (2, 'Ward 2 - Industrial Zone',           9.2),
        (3, 'Ward 3 - Riverside',                 6.8),
        (4, 'Ward 4 - Northern Suburbs',          5.4),
        (5, 'Ward 5 - Eastern Township',          9.7)
      ON CONFLICT (id) DO UPDATE SET
        name          = EXCLUDED.name,
        deficit_index = EXCLUDED.deficit_index;
    `);
    await client.query(`SELECT setval('wards_id_seq', (SELECT MAX(id) FROM wards));`);
    console.log('   ✅ 5 wards created\n');

    // ─── 2. USERS ────────────────────────────────────────────────────────────
    console.log('👥 Seeding users...');
    const hashed = await bcrypt.hash(DEFAULT_PASSWORD, 10);

    const users = [
      // Administrator
      { name: 'System Admin',       email: 'admin@townhall.com',             role: 'administrator', ward_id: 1 },

      // Responders
      { name: 'Chanda Banda',       email: 'chanda.banda@townhall.com',      role: 'responder', ward_id: 1 },
      { name: 'Thandiwe Phiri',     email: 'thandiwe.phiri@townhall.com',    role: 'responder', ward_id: 2 },
      { name: 'Musa Tembo',         email: 'musa.tembo@townhall.com',        role: 'responder', ward_id: 3 },
      { name: 'Grace Mulenga',      email: 'grace.mulenga@townhall.com',     role: 'responder', ward_id: 5 },

      // Citizens
      { name: 'John Mwanza',        email: 'john.mwanza@email.com',          role: 'citizen', ward_id: 1 },
      { name: 'Mary Kabwe',         email: 'mary.kabwe@email.com',           role: 'citizen', ward_id: 1 },
      { name: 'David Mulenga',      email: 'david.mulenga@email.com',        role: 'citizen', ward_id: 2 },
      { name: 'Ruth Bwalya',        email: 'ruth.bwalya@email.com',          role: 'citizen', ward_id: 2 },
      { name: 'Peter Zulu',         email: 'peter.zulu@email.com',           role: 'citizen', ward_id: 3 },
      { name: 'Grace Phiri',        email: 'grace.phiri@email.com',          role: 'citizen', ward_id: 3 },
      { name: 'Joseph Sakala',      email: 'joseph.sakala@email.com',        role: 'citizen', ward_id: 4 },
      { name: 'Esther Mwila',       email: 'esther.mwila@email.com',         role: 'citizen', ward_id: 4 },
      { name: 'Daniel Chanda',      email: 'daniel.chanda@email.com',        role: 'citizen', ward_id: 5 },
      { name: 'Joyce Banda',        email: 'joyce.banda@email.com',          role: 'citizen', ward_id: 5 },
    ];

    const userIds = {};
    for (const u of users) {
      const res = await client.query(
        `INSERT INTO users (name, email, password_hash, role, ward_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email) DO UPDATE SET
           name          = EXCLUDED.name,
           password_hash = EXCLUDED.password_hash,
           role          = EXCLUDED.role,
           ward_id       = EXCLUDED.ward_id
         RETURNING id, email, role`,
        [u.name, u.email, hashed, u.role, u.ward_id]
      );
      userIds[u.email] = res.rows[0].id;
      console.log(`   ✅ ${u.role.padEnd(14)} ${u.email}`);
    }
    console.log('');

    // ─── 3. ZAMBIA-SPECIFIC REPORTS ──────────────────────────────────────────
    console.log('📋 Seeding Zambia-specific reports...');
    const reports = [
      // Infrastructure
      {
        title: 'Pothole on Cairo Road blocking traffic',
        description: 'A large pothole near the intersection of Cairo Road and Church Road has been causing major traffic snarls and damaging vehicles. Multiple accidents reported this week.',
        category: 'Infrastructure',
        status: 'pending',
        location: 'Cairo Road, Lusaka CBD, Ward 1',
        lat: -15.4166, lng: 28.2833,
        user_email: 'john.mwanza@email.com',
      },
      {
        title: 'Collapsed bridge on Great North Road',
        description: 'The small bridge near Kabwe connecting two farming communities has partially collapsed after heavy rains. Trucks carrying maize to the Food Reserve Agency depot cannot pass.',
        category: 'Infrastructure',
        status: 'in_progress',
        location: 'Great North Road, Kabwe, Ward 2',
        lat: -14.4469, lng: 28.4464,
        user_email: 'david.mulenga@email.com',
        assigned_to: 'thandiwe.phiri@townhall.com',
      },
      {
        title: 'Street lights out on Kafue Road',
        description: 'Over 15 street lights along Kafue Road have been non-functional for three weeks. Armed robberies have increased in this stretch since the lights went out.',
        category: 'Safety',
        status: 'pending',
        location: 'Kafue Road, Lusaka, Ward 1',
        lat: -15.4500, lng: 28.2700,
        user_email: 'mary.kabwe@email.com',
      },

      // Water & Sanitation
      {
        title: 'LWSC water cut off for 5 days — Chilenje',
        description: 'Lusaka Water and Sewerage Company has cut water supply to Chilenje compound for 5 consecutive days with no communication. Residents are buying water from vendors at K50 per 20-litre container.',
        category: 'Water',
        status: 'pending',
        location: 'Chilenje South, Lusaka, Ward 3',
        lat: -15.4300, lng: 28.3100,
        user_email: 'peter.zulu@email.com',
      },
      {
        title: 'Broken sewer pipe flooding Kalingalinga',
        description: 'A burst sewer main is flooding three streets in Kalingalinga compound. Raw sewage is mixing with the water channel children use. Risk of cholera outbreak is high.',
        category: 'Sanitation',
        status: 'in_progress',
        location: 'Kalingalinga, Lusaka, Ward 3',
        lat: -15.4050, lng: 28.3400,
        user_email: 'grace.phiri@email.com',
        assigned_to: 'musa.tembo@townhall.com',
      },
      {
        title: 'No clean water in Kanyama for two weeks',
        description: 'Kanyama compound residents have had no piped water access since the main supply pipe burst. LWSC has not responded. Community members, especially children, are drinking from shallow wells.',
        category: 'Water',
        status: 'assigned',
        location: 'Kanyama Compound, Lusaka, Ward 5',
        lat: -15.4700, lng: 28.2300,
        user_email: 'daniel.chanda@email.com',
        assigned_to: 'grace.mulenga@townhall.com',
      },

      // Health
      {
        title: 'Chipata Clinic out of malaria drugs',
        description: 'Chipata First Level Hospital has run out of Artemether-Lumefantrine (AL) malaria treatment. Patients are being turned away. The rainy season has increased malaria cases significantly.',
        category: 'Health',
        status: 'pending',
        location: 'Chipata Clinic, Lusaka, Ward 5',
        lat: -15.3980, lng: 28.3650,
        user_email: 'joyce.banda@email.com',
      },
      {
        title: 'Only one nurse serving 300 patients daily at UTH',
        description: 'The outpatient department at the University Teaching Hospital is critically understaffed. One nurse is handling over 300 patients per shift. Patients wait over 8 hours to be seen.',
        category: 'Health',
        status: 'pending',
        location: 'UTH, Nationalist Road, Lusaka, Ward 1',
        lat: -15.4123, lng: 28.3017,
        user_email: 'esther.mwila@email.com',
      },
      {
        title: 'Cholera cases rising in George Compound',
        description: 'At least 12 confirmed cholera cases have been reported in George Compound this week. The open drain running through the market is the likely source. Urgent intervention needed.',
        category: 'Health',
        status: 'in_progress',
        location: 'George Compound, Lusaka, Ward 2',
        lat: -15.4250, lng: 28.3200,
        user_email: 'ruth.bwalya@email.com',
        assigned_to: 'chanda.banda@townhall.com',
      },

      // Education
      {
        title: 'Matero Basic School has no desks for Grade 1',
        description: 'Over 120 Grade 1 pupils at Matero Basic School are sitting on the floor because there are no desks. The school made a request to the Ministry of Education six months ago with no response.',
        category: 'Education',
        status: 'pending',
        location: 'Matero, Lusaka, Ward 4',
        lat: -15.3900, lng: 28.2800,
        user_email: 'joseph.sakala@email.com',
      },
      {
        title: 'Flooding in Chawama school classrooms',
        description: 'Three classrooms at Chawama Primary School flood every time it rains due to a broken drainage system. Teachers have suspended lessons for affected classes until repairs are made.',
        category: 'Education',
        status: 'pending',
        location: 'Chawama, Lusaka, Ward 5',
        lat: -15.4800, lng: 28.2600,
        user_email: 'daniel.chanda@email.com',
      },
      {
        title: 'No electricity at Kabwata Girls Secondary for 3 months',
        description: 'Kabwata Girls Secondary School has had no electricity supply since ZESCO disconnected them due to unpaid bills by the government. Evening prep sessions and computer lab are cancelled.',
        category: 'Education',
        status: 'assigned',
        location: 'Kabwata, Lusaka, Ward 1',
        lat: -15.4200, lng: 28.3050,
        user_email: 'mary.kabwe@email.com',
        assigned_to: 'chanda.banda@townhall.com',
      },

      // Security
      {
        title: 'Surge in vehicle break-ins at Levy Mall parking',
        description: 'At least 8 vehicles have been broken into at the Levy Junction Mall parking area in the past two weeks. Security cameras are not functional and police response has been slow.',
        category: 'Safety',
        status: 'pending',
        location: 'Levy Junction Mall, Lusaka, Ward 1',
        lat: -15.4080, lng: 28.3120,
        user_email: 'john.mwanza@email.com',
      },
      {
        title: 'Gang activity in Ng\'ombe compound at night',
        description: 'Residents of Ng\'ombe compound are afraid to go out after 8pm due to a gang that has been robbing and assaulting people near the market. Three incidents reported this week alone.',
        category: 'Safety',
        status: 'pending',
        location: "Ng'ombe Compound, Lusaka, Ward 4",
        lat: -15.3800, lng: 28.3300,
        user_email: 'joseph.sakala@email.com',
      },

      // Environment
      {
        title: 'Illegal charcoal burning destroying Lusaka forest reserve',
        description: 'Large-scale illegal charcoal production is taking place inside the Lusaka forest reserve near Leopards Hill Road. ZAFWESCO rangers are aware but lack vehicles to patrol the area.',
        category: 'Environment',
        status: 'pending',
        location: 'Leopards Hill Road, Lusaka, Ward 4',
        lat: -15.3600, lng: 28.3900,
        user_email: 'esther.mwila@email.com',
      },
      {
        title: 'Plastic waste clogging Ngwerere River',
        description: 'The Ngwerere River running through Lusaka North is severely clogged with plastic waste and industrial effluent. Fish have disappeared and the smell is affecting nearby residents.',
        category: 'Environment',
        status: 'resolved',
        location: 'Ngwerere River, Lusaka North, Ward 3',
        lat: -15.3500, lng: 28.3200,
        user_email: 'grace.phiri@email.com',
        assigned_to: 'musa.tembo@townhall.com',
      },

      // Electricity
      {
        title: 'ZESCO load shedding 18 hours daily in Ndola',
        description: 'Ndola residents are experiencing up to 18 hours of load shedding daily. Small businesses and clinics are losing thousands of kwacha daily. The local ZESCO office has not communicated a schedule.',
        category: 'Infrastructure',
        status: 'pending',
        location: 'Broadway, Ndola, Ward 2',
        lat: -12.9720, lng: 28.6364,
        user_email: 'david.mulenga@email.com',
      },
      {
        title: 'Transformer blown in Soweto Market area',
        description: 'The main transformer supplying Soweto Market and surrounding residential areas burned out four days ago. Over 2,000 households and 500 market stalls are without power.',
        category: 'Infrastructure',
        status: 'in_progress',
        location: 'Soweto Market, Lusaka, Ward 2',
        lat: -15.4350, lng: 28.2950,
        user_email: 'ruth.bwalya@email.com',
        assigned_to: 'thandiwe.phiri@townhall.com',
      },

      // Food Security
      {
        title: 'FRA depot in Mpika not buying maize from small farmers',
        description: 'The Food Reserve Agency depot in Mpika has stopped accepting maize from small-scale farmers citing "full storage" but is still buying from commercial farms. Thousands of small farmers cannot sell their harvest.',
        category: 'Agriculture',
        status: 'pending',
        location: 'FRA Depot, Mpika, Ward 3',
        lat: -11.8982, lng: 31.4497,
        user_email: 'peter.zulu@email.com',
      },
      {
        title: 'Fertiliser subsidy not reaching Petauke farmers',
        description: 'The government\'s subsidised fertiliser programme (FISP) inputs have not been distributed to Petauke district. Planting season begins in November and farmers have nothing to plant with.',
        category: 'Agriculture',
        status: 'pending',
        location: 'Petauke District, Eastern Province, Ward 5',
        lat: -14.2500, lng: 31.3333,
        user_email: 'joyce.banda@email.com',
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
      console.log(`   ✅ [${r.category.padEnd(15)}] ${r.title.substring(0, 55)}...`);
    }
    console.log('');

    // ─── 4. POLLS + VOTES ────────────────────────────────────────────────────
    console.log('🗳️  Seeding polls and votes...');
    const polls = [
      {
        category: 'roads',
        description: 'Should Cairo Road be prioritised for resurfacing before the rainy season?',
        options: ['Yes – urgent', 'Yes – schedule later', 'No – other priorities first'],
        ward_id: 1,
      },
      {
        category: 'water',
        description: 'Which solution do you prefer for recurring water shortages in Kanyama?',
        options: ['New borehole', 'Fix existing LWSC pipes', 'Community water tanks'],
        ward_id: 5,
      },
      {
        category: 'healthcare',
        description: 'What is the most urgent need at community clinics in your ward?',
        options: ['More staff', 'More medicines', 'Better equipment', 'Longer opening hours'],
        ward_id: 3,
      },
      {
        category: 'security',
        description: 'Do you support increased police patrols in Ng\'ombe compound at night?',
        options: ['Strongly support', 'Support', 'Neutral', 'Oppose'],
        ward_id: 4,
      },
      {
        category: 'education',
        description: 'What should the council prioritise for schools this term?',
        options: ['Classroom repairs', 'Desks and furniture', 'Teacher recruitment', 'School feeding programme'],
        ward_id: 2,
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

      for (let i = 0; i < 5 + Math.floor(Math.random() * 10); i++) {
        const hash = `seed_${pollId}_${i}_${Date.now()}`;
        await client.query(
          `INSERT INTO votes (poll_id, vote_hash, option_index) VALUES ($1, $2, $3)`,
          [pollId, hash, Math.floor(Math.random() * p.options.length)]
        );
      }
      console.log(`   ✅ [${p.category.padEnd(12)}] ${p.description.substring(0, 55)}...`);
    }
    console.log('');

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
    console.log('Citizens:');
    console.log('   john.mwanza@email.com');
    console.log('   mary.kabwe@email.com');
    console.log('   david.mulenga@email.com');
    console.log('   ruth.bwalya@email.com');
    console.log('   peter.zulu@email.com');
    console.log('   grace.phiri@email.com');
    console.log('   joseph.sakala@email.com');
    console.log('   esther.mwila@email.com');
    console.log('   daniel.chanda@email.com');
    console.log('   joyce.banda@email.com\n');

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