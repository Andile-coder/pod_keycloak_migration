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

async function getUsersWithRoles() {
  try {
    const result = await pool.query(`
      SELECT u.id, u.email, u.first_name, u.last_name, u."phoneNumber", u.keycloak_user_id, 
             STRING_AGG(r.name, ',') as roles
      FROM "user" u
      LEFT JOIN user_roles ur ON u.id = ur."userId"
      LEFT JOIN roles r ON ur."roleId" = r.id
      WHERE u.keycloak_user_id IS NULL
      GROUP BY u.id, u.email, u.first_name, u.last_name, u."phoneNumber", u.keycloak_user_id
    `);
    const headers = Object.keys(result.rows[0] || {});
    const csvContent = [headers.join(','), ...result.rows.map(row => headers.map(h => row[h]).join(','))].join('\n');
    fs.writeFileSync('users_with_roles.csv', csvContent);
    console.log(`${result.rows.length} user-role records saved to users_with_roles.csv`);
  } catch (err) {
    console.error('Error fetching users with roles:', err);
  }
}

getUsersWithRoles();