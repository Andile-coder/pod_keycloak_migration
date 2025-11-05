require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function getCustomers() {
  try {
    const result = await pool.query('SELECT * FROM customers');
    const headers = Object.keys(result.rows[0] || {});
    const csvContent = [headers.join(','), ...result.rows.map(row => headers.map(h => row[h]).join(','))].join('\n');
    fs.writeFileSync('customers.csv', csvContent);
    console.log(`${result.rows.length} customers saved to customers.csv`);
  } catch (err) {
    console.error('Error fetching customers:', err);
  } finally {
    pool.end();
  }
}

getCustomers();