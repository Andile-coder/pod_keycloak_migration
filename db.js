require('dotenv').config();
const { Pool } = require('pg');
const axios = require('axios');
const fs = require('fs');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function getRoles() {
  try {
    const result = await pool.query('SELECT * FROM roles');
    const roles = result.rows.map(row => row.name);
    fs.writeFileSync('roles.txt', roles.join('\n'));
    console.log(`${roles.length} roles saved to roles.txt`);
  } catch (err) {
    console.error('Error fetching roles:', err);
  }
}

async function getUsers() {
  try {
    const result = await pool.query('SELECT * FROM "user"');
    const headers = Object.keys(result.rows[0] || {});
    const csvContent = [headers.join(','), ...result.rows.map(row => headers.map(h => row[h]).join(','))].join('\n');
    fs.writeFileSync('users.csv', csvContent);
    console.log(`${result.rows.length} users saved to users.csv`);
  } catch (err) {
    console.error('Error fetching users:', err);
  }
}

getUsers();
// getRoles();