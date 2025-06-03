const path = require('path');

// More robust path resolution for .env file
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const BOT_TOKEN = process.env.BOT_TOKEN;
const STRATZ_API_TOKEN = process.env.STRATZ_API_TOKEN;
const STRATZ_API_URL = 'https://api.stratz.com/graphql';

// Basic check to see if the token is loaded
if (STRATZ_API_TOKEN) {
  console.log(
    '[Config] STRATZ_API_TOKEN loaded (first 5 chars):',
    STRATZ_API_TOKEN.substring(0, 5)
  );
} else {
  console.error(
    '[Config] FATAL ERROR: STRATZ_API_TOKEN is not defined. Please check your .env file and its path.'
  );
  // Consider exiting if the token is critical for bot operation:
  // process.exit(1);
}

if (!BOT_TOKEN) {
  console.error(
    '[Config] FATAL ERROR: BOT_TOKEN is not defined. Please check your .env file and its path.'
  );
  // process.exit(1);
}

module.exports = {
  BOT_TOKEN,
  STRATZ_API_TOKEN,
  STRATZ_API_URL,
  // STRATZ_HEADERS is no longer defined here; it's created in StratzService instance
};
