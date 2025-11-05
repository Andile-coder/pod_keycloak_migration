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
    // Use phoneNumber as username, fallback to email if no phone
    const username = user.phoneNumber || user.email;
    
    if (!user.phoneNumber) {
      const logData = {
        status: 'WARNING',
        db_user_id: user.id,
        email: user.email,
        message: 'Using email as username - no phone number'
      };
      logMigration(logData);
      console.log(`Warning: Using email as username for ${user.email} - no phone number`);
    }

    const response = await axios.post(`${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users`, {
      username: username,
      email: user.email,
      firstName: user.first_name || '',
      lastName: user.last_name || '',
      enabled: true,
      attributes: {
        phoneNumber: user.phoneNumber ? [`1${user.phoneNumber}`] : []
      }
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    const keycloakUserId = response.headers.location.split('/').pop();
    console.log(`Created user: ${user.email} - Keycloak ID: ${keycloakUserId}`);
    return keycloakUserId;
  } catch (err) {
    const logData = {
      status: 'ERROR',
      db_user_id: user.id,
      email: user.email,
      phoneNumber: user.phoneNumber,
      error: err.response?.data || err.message
    };
    logMigration(logData);
    console.error(`Error creating user ${user.email}:`, err.response?.data || err.message);
    return null;
  }
}

async function assignRealmRoles(keycloakUserId, roles, token) {
  try {
    if (!roles || roles === 'null') {
      console.log(`No roles to assign for user ${keycloakUserId}`);
      return;
    }

    const roleNames = roles.split(',').map(role => role.trim()).filter(role => role);
    
    if (roleNames.length === 0) {
      console.log(`No valid roles to assign for user ${keycloakUserId}`);
      return;
    }

    const roleObjects = [];
    for (const roleName of roleNames) {
      try {
        const roleResponse = await axios.get(`${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/roles/${roleName}`, 
          { headers: { Authorization: `Bearer ${token}` } }
        );
        roleObjects.push(roleResponse.data);
      } catch (roleErr) {
        console.error(`Role '${roleName}' not found, skipping`);
      }
    }
    
    if (roleObjects.length > 0) {
      await axios.post(`${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users/${keycloakUserId}/role-mappings/realm`, 
        roleObjects,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      console.log(`Assigned roles ${roleObjects.map(r => r.name).join(', ')} to user ${keycloakUserId}`);
    }
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

async function fullMigration() {
  try {
    console.log('Starting full migration...');
    
    // Step 1: Export users with roles
    console.log('Step 1: Exporting users with roles...');
    const result = await pool.query(`
      SELECT u.id, u.email, u.first_name, u.last_name, u."phoneNumber", u.keycloak_user_id, 
             STRING_AGG(r.name, ',') as roles
      FROM "user" u
      LEFT JOIN user_roles ur ON u.id = ur."userId"
      LEFT JOIN roles r ON ur."roleId" = r.id
      WHERE u.keycloak_user_id IS NULL
      GROUP BY u.id, u.email, u.first_name, u.last_name, u."phoneNumber", u.keycloak_user_id
    `);
    
    const users = result.rows;
    console.log(`Found ${users.length} users to migrate`);
    
    if (users.length === 0) {
      console.log('No users to migrate');
      return;
    }
    
    // Step 2: Initialize log file
    fs.writeFileSync('migration_log.csv', 'timestamp,data\n');
    
    // Step 3: Migrate users to Keycloak
    console.log('Step 2: Creating users in Keycloak...');
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
        // Log success
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
        
        // Assign roles if they exist
        if (user.roles) {
          await assignRealmRoles(keycloakUserId, user.roles, token);
        }
        
        // Update database
        await updateUserKeycloakId(user.id, keycloakUserId);
      }
      
      // Rate limiting
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

fullMigration();