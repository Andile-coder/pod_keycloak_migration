require('dotenv').config();
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

async function createRealmRole(roleName, token) {
  try {
    await axios.post(`${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/roles`, 
      { name: roleName },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    console.log(`Role '${roleName}' created`);
  } catch (err) {
    console.error(`Error creating role '${roleName}':`, err.response?.data || err.message);
  }
}

async function migrateRoles() {
  try {
    const roles = fs.readFileSync('roles.txt', 'utf8').split('\n').filter(role => role.trim());
    const token = await getKeycloakToken();
    
    for (const role of roles) {
      await createRealmRole(role.trim(), token);
    }
    
    console.log(`Migration complete: ${roles.length} roles processed`);
  } catch (err) {
    console.error('Migration error:', err);
  }
}

migrateRoles();