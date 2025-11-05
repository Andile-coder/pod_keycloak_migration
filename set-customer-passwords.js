require('dotenv').config({ path: '.env.customer' });
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

async function getKeycloakToken() {
  const response = await axios.post(`${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}/protocol/openid-connect/token`, 
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.KEYCLOAK_CLIENT_ID,
      client_secret: process.env.KEYCLOAK_CLIENT_SECRET
    })
  );
  return response.data.access_token;
}

function logPassword(data) {
  const logEntry = `${new Date().toISOString()},${JSON.stringify(data)}\n`;
  fs.appendFileSync('customer_password_log.csv', logEntry);
}

async function setPassword(keycloakUserId, email, token) {
  try {
    const tempPassword = `${email}_2025`;
    
    await axios.put(`${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users/${keycloakUserId}/reset-password`, 
      {
        type: 'password',
        value: tempPassword,
        temporary: true
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    
    logPassword({
      status: 'SUCCESS',
      action: 'SET_PASSWORD',
      keycloak_user_id: keycloakUserId,
      email: email,
      temp_password: tempPassword
    });
    
    console.log(`Set password for ${email}: ${tempPassword}`);
  } catch (err) {
    logPassword({
      status: 'ERROR',
      action: 'SET_PASSWORD',
      keycloak_user_id: keycloakUserId,
      email: email,
      error: err.response?.data || err.message
    });
    console.error(`Error setting password for ${email}:`, err.response?.data || err.message);
  }
}

async function setCustomerPasswords() {
  try {
    console.log('Setting temporary passwords for customers...');
    
    // Initialize log file
    fs.writeFileSync('customer_password_log.csv', 'timestamp,data\n');
    
    // Get customers with keycloak_user_id
    const result = await pool.query('SELECT email, keycloak_user_id FROM customer_user WHERE keycloak_user_id IS NOT NULL');
    const customers = result.rows;
    
    console.log(`Found ${customers.length} customers to set passwords for`);
    
    if (customers.length === 0) {
      console.log('No customers found with Keycloak IDs');
      return;
    }
    
    const token = await getKeycloakToken();
    
    for (const customer of customers) {
      await setPassword(customer.keycloak_user_id, customer.email, token);
    }
    
    console.log(`Password setting complete: ${customers.length} customers processed. Check customer_password_log.csv for details.`);
  } catch (err) {
    console.error('Password setting error:', err);
    logPassword({
      status: 'ERROR',
      action: 'SET_PASSWORDS',
      error: err.message
    });
  }
}

setCustomerPasswords();