// ============================================================================
// Server entry point
// ============================================================================
require('dotenv').config();

const createApp = require('./src/app');
const { initDatabase, DB_PATH } = require('./src/db');

initDatabase();

const app = createApp();
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log('='.repeat(60));
  console.log('  MCQ Test Application — server running');
  console.log(`  Local:    http://localhost:${PORT}`);
  console.log(`  Database: ${DB_PATH}`);
  console.log('='.repeat(60));
});
