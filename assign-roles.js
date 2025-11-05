require('dotenv').config();
const axios = require('axios');

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

async function assignRoles() {
  const token = await getKeycloakToken();
  await assignRealmRoles('9fdbe103-4768-4ec7-b091-fb0c6ffe4312', 'SUPERADMIN', token);
}

assignRoles();