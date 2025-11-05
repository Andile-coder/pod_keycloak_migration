require('dotenv').config({ path: '.env.customer' });
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function checkTable() {
  try {
    const result = await pool.query('SELECT * FROM customers LIMIT 1');
    console.log('Customers table columns:', Object.keys(result.rows[0] || {}));
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    pool.end();
  }
}

checkTable();