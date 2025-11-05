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

function logCustomer(data) {
  const logEntry = `${new Date().toISOString()},${JSON.stringify(data)}\n`;
  fs.appendFileSync('customer_migration_log.csv', logEntry);
}

async function createCustomerRole(token) {
  try {
    await axios.post(`${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/roles`, 
      { name: 'CUSTOMER_USER' },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    logCustomer({ status: 'SUCCESS', action: 'CREATE_ROLE', role_name: 'CUSTOMER_USER' });
    console.log('Role CUSTOMER_USER created');
  } catch (err) {
    if (err.response?.data?.errorMessage?.includes('already exists')) {
      logCustomer({ status: 'INFO', action: 'CREATE_ROLE', role_name: 'CUSTOMER_USER', message: 'Role already exists' });
      console.log('Role CUSTOMER_USER already exists');
    } else {
      logCustomer({ status: 'ERROR', action: 'CREATE_ROLE', error: err.response?.data || err.message });
      throw err;
    }
  }
}

async function createKeycloakCustomer(customer, token) {
  try {
    const response = await axios.post(`${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users`, {
      username: customer.email,
      email: customer.email,
      firstName: customer.name || '',
      enabled: true
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    const keycloakUserId = response.headers.location.split('/').pop();
    console.log(`Created customer: ${customer.email} - Keycloak ID: ${keycloakUserId}`);
    return keycloakUserId;
  } catch (err) {
    logCustomer({
      status: 'ERROR',
      action: 'CREATE_USER',
      customer_id: customer.id,
      email: customer.email,
      error: err.response?.data || err.message
    });
    console.error(`Error creating customer ${customer.email}:`, err.response?.data || err.message);
    return null;
  }
}

async function setTempPassword(keycloakUserId, email, token) {
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
    
    logCustomer({
      status: 'SUCCESS',
      action: 'SET_PASSWORD',
      keycloak_user_id: keycloakUserId,
      email: email,
      temp_password: tempPassword
    });
    
    console.log(`Set password for ${email}: ${tempPassword}`);
  } catch (err) {
    logCustomer({
      status: 'ERROR',
      action: 'SET_PASSWORD',
      keycloak_user_id: keycloakUserId,
      email: email,
      error: err.response?.data || err.message
    });
    console.error(`Error setting password for ${email}:`, err.response?.data || err.message);
  }
}

async function assignCustomerRole(keycloakUserId, token) {
  try {
    const roleResponse = await axios.get(`${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/roles/CUSTOMER_USER`, 
      { headers: { Authorization: `Bearer ${token}` } }
    );
    
    await axios.post(`${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users/${keycloakUserId}/role-mappings/realm`, 
      [roleResponse.data],
      { headers: { Authorization: `Bearer ${token}` } }
    );
    console.log(`Assigned CUSTOMER_USER role to ${keycloakUserId}`);
  } catch (err) {
    logCustomer({
      status: 'ERROR',
      action: 'ASSIGN_ROLE',
      keycloak_user_id: keycloakUserId,
      error: err.response?.data || err.message
    });
    console.error(`Error assigning role to ${keycloakUserId}:`, err.response?.data || err.message);
  }
}

async function updateCustomerKeycloakId(customerId, keycloakUserId) {
  try {
    await pool.query('UPDATE customer_user SET keycloak_user_id = $1 WHERE id = $2', [keycloakUserId, customerId]);
    console.log(`Updated customer ${customerId} with Keycloak ID: ${keycloakUserId}`);
  } catch (err) {
    logCustomer({
      status: 'ERROR',
      action: 'UPDATE_DB',
      customer_id: customerId,
      error: err.message
    });
    console.error(`Error updating customer ${customerId}:`, err);
  }
}

async function migrateCustomers() {
  try {
    console.log('Starting customer migration...');
    
    // Initialize log file
    fs.writeFileSync('customer_migration_log.csv', 'timestamp,data\n');
    
    // Step 1: Create CUSTOMER_USER role
    console.log('Step 1: Creating CUSTOMER_USER role...');
    const token = await getKeycloakToken();
    await createCustomerRole(token);
    
    // Step 2: Find customers without keycloak_user_id
    console.log('Step 2: Finding customers without Keycloak ID...');
    const result = await pool.query('SELECT id, email, name FROM customer_user WHERE keycloak_user_id IS NULL');
    const customers = result.rows;
    console.log(`Found ${customers.length} customers to migrate`);
    
    if (customers.length === 0) {
      console.log('No customers to migrate');
      return;
    }
    
    // Step 3-5: Create users, update DB, assign roles
    console.log('Step 3-5: Creating users in Keycloak...');
    for (const customer of customers) {
      const keycloakUserId = await createKeycloakCustomer(customer, token);
      
      if (keycloakUserId) {
        // Log success
        logCustomer({
          status: 'SUCCESS',
          action: 'CREATE_USER',
          customer_id: customer.id,
          email: customer.email,
          name: customer.name,
          keycloak_user_id: keycloakUserId
        });
        
        // Update database
        await updateCustomerKeycloakId(customer.id, keycloakUserId);
        
        // Set temporary password
        await setTempPassword(keycloakUserId, customer.email, token);
        
        // Assign role
        await assignCustomerRole(keycloakUserId, token);
      }
    }
    
    console.log(`Migration complete: ${customers.length} customers processed. Check customer_migration_log.csv for details.`);
  } catch (err) {
    console.error('Migration error:', err);
    logCustomer({
      status: 'ERROR',
      action: 'MIGRATION',
      error: err.message
    });
  }
}

migrateCustomers();