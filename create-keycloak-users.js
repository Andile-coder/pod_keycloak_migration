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

function logMigration(data) {
  const logEntry = `${new Date().toISOString()},${JSON.stringify(data)}\n`;
  fs.appendFileSync('migration_log.csv', logEntry);
}

async function createKeycloakUser(user, token) {
  try {
    const response = await axios.post(`${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users`, {
      username: user.phoneNumber,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      enabled: true,
      attributes: {
        phoneNumber: [user.phoneNumber]
      }
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    const keycloakUserId = response.headers.location.split('/').pop();
    const logData = {
      status: 'SUCCESS',
      db_user_id: user.id,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      phoneNumber: user.phoneNumber,
      keycloak_user_id: keycloakUserId,
      roles: user.roles
    };
    logMigration(logData);
    console.log(`Created user: ${user.email} - Keycloak ID: ${keycloakUserId}`);
    return keycloakUserId;
  } catch (err) {
    const logData = {
      status: 'ERROR',
      db_user_id: user.id,
      email: user.email,
      error: err.response?.data || err.message
    };
    logMigration(logData);
    console.error(`Error creating user ${user.email}:`, err.response?.data || err.message);
    return null;
  }
}

async function assignRealmRoles(keycloakUserId, roles, token) {
  try {
    const roleNames = roles.split(',').map(role => role.trim()).filter(role => role);
    
    // Get role objects with IDs from Keycloak
    const roleObjects = [];
    for (const roleName of roleNames) {
      const roleResponse = await axios.get(`${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/roles/${roleName}`, 
        { headers: { Authorization: `Bearer ${token}` } }
      );
      roleObjects.push(roleResponse.data);
    }
    
    await axios.post(`${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users/${keycloakUserId}/role-mappings/realm`, 
      roleObjects,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    console.log(`Assigned roles ${roleNames.join(', ')} to user ${keycloakUserId}`);
  } catch (err) {
    console.error(`Error assigning roles to user ${keycloakUserId}:`, err.response?.data || err.message);
  }
}

async function updateUserKeycloakId(userId, keycloakUserId) {
  try {
    await pool.query('UPDATE "user" SET keycloak_user_id = $1 WHERE id = $2', [keycloakUserId, userId]);
    console.log(`Updated DB user ${userId} with Keycloak ID: ${keycloakUserId}`);
  } catch (err) {
    console.error(`Error updating user ${userId}:`, err);
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function migrateUsers() {
  try {
    fs.writeFileSync('migration_log.csv', 'timestamp,data\n');
    
    const csvData = fs.readFileSync('users_with_roles.csv', 'utf8');
    const lines = csvData.split('\n').filter(line => line.trim());
    const headers = lines[0].split(',');
    const users = lines.slice(1).map(line => {
      const values = line.split(',');
      return headers.reduce((obj, header, index) => {
        obj[header] = values[index];
        return obj;
      }, {});
    });

    let token = await getKeycloakToken();
    let tokenTime = Date.now();
    
    for (let i = 0; i < users.length; i++) {
      // Refresh token every 4 minutes
      if (Date.now() - tokenTime > 240000) {
        token = await getKeycloakToken();
        tokenTime = Date.now();
      }
      
      const user = users[i];
      const keycloakUserId = await createKeycloakUser(user, token);
      if (keycloakUserId) {
        await assignRealmRoles(keycloakUserId, user.roles, token);
        await updateUserKeycloakId(user.id, keycloakUserId);
      }
      
      // Rate limiting: 100ms delay between requests
      await sleep(100);
      
      if ((i + 1) % 50 === 0) {
        console.log(`Processed ${i + 1}/${users.length} users`);
      }
    }
    
    console.log(`Migration complete: ${users.length} users processed. Check migration_log.csv for details.`);
  } catch (err) {
    console.error('Migration error:', err);
  }
}

migrateUsers();