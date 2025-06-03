const POSITIONS = {
  POSITION_1: 'Керри',
  POSITION_2: 'Мидер',
  POSITION_3: 'Оффлейнер',
  POSITION_4: 'Саппорт',
  POSITION_5: 'Полная поддержка',
};

const RANK_DISPLAY_MAP = {
  HERALD: 'Рекрут',
  GUARDIAN: 'Страж',
  CRUSADER: 'Рыцарь',
  ARCHON: 'Герой',
  LEGEND: 'Легенда',
  ANCIENT: 'Властелин',
  DIVINE: 'Божество',
  IMMORTAL: 'Титан',
};

const UNKNOWN_ABILITY_ID = 0;
const UNKNOWN_ITEM_ID = 0;

const RANK_USER_CHOICE_TO_KEY = {
  Рекрут: 'KEY_HERALD',
  Страж: 'KEY_GUARDIAN',
  Рыцарь: 'KEY_CRUSADER',
  Герой: 'KEY_ARCHON',
  Легенда: 'KEY_LEGEND',
  Властелин: 'KEY_ANCIENT',
  Божество: 'KEY_DIVINE',
  Титан: 'KEY_IMMORTAL',
  // 'Некалиброванный': 'KEY_UNCALIBRATED', // Optional
};

const KEY_TO_RANK_BRACKET_ARRAY = {
  KEY_HERALD: ['HERALD'],
  KEY_GUARDIAN: ['GUARDIAN'],
  KEY_CRUSADER: ['CRUSADER'],
  KEY_ARCHON: ['ARCHON'],
  KEY_LEGEND: ['LEGEND'],
  KEY_ANCIENT: ['ANCIENT'],
  KEY_DIVINE: ['DIVINE'],
  KEY_IMMORTAL: ['IMMORTAL'],
  // 'KEY_UNCALIBRATED': ['UNCALIBRATED'], // Optional
};

// Numeric rank IDs (0-80) as expected by heroPerformance query's rankIds field
// Based on 'XX' system: first digit is tier (1-8), second is star (1-5 for Herald-Divine)
// 80 is for general Immortal. 0 for Uncalibrated.
const KEY_TO_RANK_ID_INT = {
  KEY_HERALD: [11, 12, 13, 14, 15], // Herald 1-5
  KEY_GUARDIAN: [21, 22, 23, 24, 25], // Guardian 1-5
  KEY_CRUSADER: [31, 32, 33, 34, 35], // Crusader 1-5
  KEY_ARCHON: [41, 42, 43, 44, 45], // Archon 1-5
  KEY_LEGEND: [51, 52, 53, 54, 55], // Legend 1-5
  KEY_ANCIENT: [61, 62, 63, 64, 65], // Ancient 1-5
  KEY_DIVINE: [71, 72, 73, 74, 75], // Divine 1-5
  KEY_IMMORTAL: [80], // General Immortal (covers ranks without specific numeric leaderboard position displayed)
  // For 'KEY_UNCALIBRATED', you might use [0]. For simplicity, not including it now unless requested.
};

// These are the actual RankBracketBasicEnum values expected by Stratz API
// for endpoints like itemFullPurchase, abilityMinLevel etc.
const KEY_TO_RANK_BRACKET_BASIC_ENUM_STRING = {
  KEY_HERALD: 'HERALD_GUARDIAN',
  KEY_GUARDIAN: 'HERALD_GUARDIAN',
  KEY_CRUSADER: 'CRUSADER_ARCHON',
  KEY_ARCHON: 'CRUSADER_ARCHON',
  KEY_LEGEND: 'LEGEND_ANCIENT',
  KEY_ANCIENT: 'LEGEND_ANCIENT',
  KEY_DIVINE: 'DIVINE_IMMORTAL',
  KEY_IMMORTAL: 'DIVINE_IMMORTAL',
  // 'KEY_UNCALIBRATED': 'UNCALIBRATED', // Or whatever the API expects for uncalibrated if it's a separate basic enum
};

module.exports = {
  POSITIONS,
  RANK_DISPLAY_MAP,
  UNKNOWN_ABILITY_ID,
  UNKNOWN_ITEM_ID,
  RANK_USER_CHOICE_TO_KEY,
  KEY_TO_RANK_BRACKET_ARRAY,
  KEY_TO_RANK_ID_INT,
  KEY_TO_RANK_BRACKET_BASIC_ENUM_STRING,
};
