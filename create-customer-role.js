require('dotenv').config({ path: '.env.customer' });
const axios = require('axios');
const fs = require('fs');

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

function logCustomer(data) {
  const logEntry = `${new Date().toISOString()},${JSON.stringify(data)}\n`;
  fs.appendFileSync('customer_log.csv', logEntry);
}

async function createCustomerRole() {
  try {
    // Initialize log file
    fs.writeFileSync('customer_log.csv', 'timestamp,data\n');
    
    const token = await getKeycloakToken();
    
    await axios.post(`${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/roles`, 
      { name: 'CUSTOMER_USER' },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    
    const logData = {
      status: 'SUCCESS',
      action: 'CREATE_ROLE',
      role_name: 'CUSTOMER_USER',
      realm: process.env.KEYCLOAK_REALM
    };
    logCustomer(logData);
    console.log('Role CUSTOMER_USER created successfully');
  } catch (err) {
    const logData = {
      status: 'ERROR',
      action: 'CREATE_ROLE',
      role_name: 'CUSTOMER_USER',
      error: err.response?.data || err.message
    };
    logCustomer(logData);
    console.error('Error creating role:', err.response?.data || err.message);
  }
}

createCustomerRole();