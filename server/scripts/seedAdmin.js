// server/scripts/seedAdmin.js
const pool = require('../db');
const bcrypt = require('bcryptjs');

async function seedAdmin() {
  const email = 'admin@townhall.com';
  const password = 'Admin@WeaponX'; // Change this to a strong password!
  const hashedPassword = await bcrypt.hash(password, 10);

  try {
    // Insert admin. ON CONFLICT prevents errors if you run this twice.
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role) 
       VALUES ($1, $2, $3, $4) 
       ON CONFLICT (email) DO NOTHING 
       RETURNING id, email, role`,
      ['System Admin', email, hashedPassword, 'administrator']
    );

    if (result.rowCount === 0) {
      console.log('⚠️ Admin account already exists.');
    } else {
      console.log('✅ Admin account created successfully!');
      console.log(`   Email: ${email}`);
      console.log(`   Password: ${password}`);
    }
  } catch (err) {
    console.error('❌ Failed to seed admin:', err.message);
  } finally {
    // Close the database connection so the script exits
    await pool.end(); 
  }
}

seedAdmin();