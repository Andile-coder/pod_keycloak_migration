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

async function resetKeycloakIds() {
  try {
    console.log('Resetting keycloak_user_id for migrated users...');
    
    // Read migration log to get list of successfully migrated users
    const logData = fs.readFileSync('migration_log.csv', 'utf8');
    const lines = logData.split('\n').filter(line => line.trim() && !line.startsWith('timestamp'));
    
    const successfulUserIds = [];
    lines.forEach(line => {
      try {
        const commaIndex = line.indexOf(',');
        if (commaIndex > 0) {
          const jsonPart = line.substring(commaIndex + 1);
          const data = JSON.parse(jsonPart);
          if (data.status === 'SUCCESS' && data.db_user_id) {
            successfulUserIds.push(data.db_user_id);
          }
        }
      } catch (e) {
        // Skip invalid lines
      }
    });
    
    if (successfulUserIds.length === 0) {
      console.log('No successfully migrated users found in log');
      return;
    }
    
    console.log(`Found ${successfulUserIds.length} users to reset`);
    
    // Exclude the specific user from reset
    const filteredUserIds = successfulUserIds.filter(id => id !== 'cec431ee-3bc1-4dc2-9b40-138d825b6141');
    
    if (filteredUserIds.length === 0) {
      console.log('No users to reset after filtering');
      return;
    }
    
    // Reset keycloak_user_id for these specific users
    const placeholders = filteredUserIds.map((_, i) => `$${i + 1}`).join(',');
    const result = await pool.query(
      `UPDATE "user" SET keycloak_user_id = NULL WHERE id IN (${placeholders})`,
      filteredUserIds
    );
    
    console.log(`Reset complete: ${result.rowCount} users updated`);
  } catch (err) {
    console.error('Reset error:', err);
  } finally {
    pool.end();
  }
}

resetKeycloakIds();