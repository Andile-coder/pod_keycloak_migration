require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function checkUser() {
  try {
    const result = await pool.query('SELECT id, email, first_name, last_name, keycloak_user_id FROM "user" WHERE keycloak_user_id = $1', 
      ['9e8f93f5-5a0b-4bab-a10d-378d6878ce35']
    );
    
    if (result.rows.length > 0) {
      console.log('User found:', result.rows[0]);
    } else {
      console.log('User not found');
    }
  } catch (err) {
    console.error('Error:', err);
  } finally {
    pool.end();
  }
}

checkUser();