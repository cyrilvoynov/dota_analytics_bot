const { Telegraf, Markup } = require('telegraf');
const { BOT_TOKEN, STRATZ_API_TOKEN } = require('./config/config');
const {
  POSITIONS,
  RANK_USER_CHOICE_TO_KEY,
  // KEY_TO_RANK_ID_INT, // Removed as unused by ESLint
  // KEY_TO_RANK_BRACKET_ARRAY, // Commented out as unused by ESLint
  // KEY_TO_RANK_BRACKET_BASIC_ENUM_STRING, // Commented out as unused by ESLint
} = require('./constants/gameConstants');
const StratzService = require('./services/stratzService');
const fs = require('fs').promises; // Added for file system operations
const path = require('path'); // Added for path manipulation
const DataProcessor = require('./utils/dataProcessor');
const { escapeHTML } = require('./utils/messageUtils');
const cron = require('node-cron'); // Added node-cron import

// --- DEBUG: Clear StratzService from require cache ---
try {
  const stratzServicePath = require.resolve('./services/stratzService');
  if (require.cache[stratzServicePath]) {
    delete require.cache[stratzServicePath];
    console.log('[DEBUG CACHE] Cleared StratzService from require cache.');
  }
} catch (e) {
  console.warn('[DEBUG CACHE] Could not clear StratzService from cache:', e.message);
}
// --- END DEBUG ---

// --- DEBUG: Clear DataProcessor from require cache ---
const dataProcessorPath = require.resolve('./utils/dataProcessor');
if (require.cache[dataProcessorPath]) {
  delete require.cache[dataProcessorPath];
  console.log('[DEBUG CACHE] Cleared DataProcessor from require cache.');
}
// --- END DEBUG ---

// Cache settings
const SKILL_BUILD_CACHE_DIR = path.join(__dirname, '..', 'cache', 'skill_builds');
const SKILL_BUILD_CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Ensure cache directory exists on startup
async function ensureCacheDirExists() {
  try {
    await fs.mkdir(SKILL_BUILD_CACHE_DIR, { recursive: true });
    console.log(`Cache directory ${SKILL_BUILD_CACHE_DIR} ensured.`);
  } catch (error) {
    console.error('Error creating cache directory:', error);
    // Allow bot to continue, but caching might fail
  }
}

// Helper function to chunk array for keyboard rows
function chunkArray(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

// NEW: Utility function for padding strings for table formatting
function padString(str, len, char = ' ') {
  str = String(str);
  if (str.length > len) {
    if (len < 2) return str.substring(0, len); // Not enough space for '..', just truncate
    return str.substring(0, len - 2) + '..';
  } else {
    return str + char.repeat(len - str.length);
  }
}

// Initialize bot
const bot = new Telegraf(BOT_TOKEN);
const stratzService = new StratzService(STRATZ_API_TOKEN);
const userState = {};
let HERO_MAP = {};
let ABILITY_MAP = {};
let ITEM_MAP = {};
// let PATCH_ID = null; // Removed as unused by ESLint, StratzService handles its own PATCH_ID
// const DEFAULT_PATCH_ID_FALLBACK = null; // Removed as unused by ESLint

async function initializeBot() {
  console.log('🚀 Initializing bot data from StratzService instance...');
  try {
    await stratzService.initializationPromise;
    console.log('✅ StratzService instance is confirmed initialized.');
    HERO_MAP = stratzService.HERO_MAP;
    ABILITY_MAP = stratzService.ABILITY_MAP;
    ITEM_MAP = stratzService.ITEM_MAP;
    // PATCH_ID = stratzService.PATCH_ID;
    if (
      Object.keys(HERO_MAP).length === 0 ||
      Object.keys(ABILITY_MAP).length === 0 ||
      Object.keys(ITEM_MAP).length === 0
    ) {
      console.error('❌ Critical: Game data maps are empty after StratzService initialization.');
      throw new Error('Failed to load essential game data from StratzService.');
    }
    console.log('✅ Bot data initialized from StratzService instance.');
  } catch (error) {
    console.error(
      '❌ Failed to initialize bot data from StratzService:',
      error.message,
      error.stack
    );
    process.exit(1);
  }
}

// --- Keyboard Helper Functions ---
function createRankKeyboard() {
  const rankUserChoices = Object.keys(RANK_USER_CHOICE_TO_KEY);
  const rankButtons = rankUserChoices.map((rankChoiceText) => {
    const rankKey = RANK_USER_CHOICE_TO_KEY[rankChoiceText];
    return Markup.button.callback(rankChoiceText, `rank_${rankKey}`);
  });
  return Markup.inlineKeyboard(chunkArray(rankButtons, 2));
}

function createPositionKeyboard(_chatId) {
  const positionDisplayNames = Object.values(POSITIONS);
  const positionButtons = positionDisplayNames.map((posName) => {
    const posKey = Object.keys(POSITIONS).find((key) => POSITIONS[key] === posName);
    return Markup.button.callback(posName, `pos_${posKey}`);
  });

  const navButtons = [Markup.button.callback('🏠 Домой', 'nav_home')];
  // Example: If you want a "Back to Ranks" button that is different from "Home"
  // navButtons.unshift(Markup.button.callback('⬅️ Назад к рангам', 'nav_back_to_ranks'));

  const keyboardRows = chunkArray(positionButtons, 2);
  keyboardRows.push(navButtons);
  return Markup.inlineKeyboard(keyboardRows);
}

function createHeroSelectionKeyboard(_chatId, topHeroes) {
  // This function now receives topHeroes which might be up to 6 heroes.
  // The existing slice(0,5) was in DataProcessor, now changed to slice(0,6) there.
  // So, this keyboard will correctly show up to 6 heroes if topHeroes contains that many.
  const heroButtons = topHeroes.map((h) => {
    // No slice here, use all topHeroes provided
    const heroName = HERO_MAP[h.heroId] || `HeroID ${h.heroId}`;
    return Markup.button.callback(heroName.substring(0, 25), `hero_${h.heroId}`);
  });

  const navButtons = [
    Markup.button.callback('⬅️ Назад', 'nav_back_to_positions'),
    Markup.button.callback('🏠 Домой', 'nav_home'),
  ];
  const keyboardRows = chunkArray(heroButtons, 2); // Max 3 rows of 2 heroes if 6 heroes
  keyboardRows.push(navButtons);
  return Markup.inlineKeyboard(keyboardRows);
}

function createBuildChoiceKeyboard(_chatId, heroId) {
  const buildButtons = [
    Markup.button.callback('Предметы', `build_item_${heroId}`),
    Markup.button.callback('Навыки', `build_skill_${heroId}`),
  ];
  const navButtons = [
    Markup.button.callback('⬅️ Назад (к выбору героя)', `nav_back_to_heroes`),
    Markup.button.callback('🏠 Домой', 'nav_home'),
  ];
  const keyboardRows = [buildButtons, navButtons]; // Builds on one row, nav on another
  return Markup.inlineKeyboard(keyboardRows);
}

// --- Action Handlers ---

bot.command('start', (ctx) => {
  console.log(`👤 User ${ctx.from.id} started the bot with /start`);
  const chatId = ctx.chat.id || ctx.from.id;
  userState[chatId] = {};

  ctx.reply('👋 Добро пожаловать! Выберите ваш ранг:', createRankKeyboard());
});

bot.action('nav_home', async (ctx) => {
  const chatId = ctx.chat.id || ctx.from.id;
  console.log(`👤 User ${ctx.from.id} (ChatID: ${chatId}) pressed Home`);
  userState[chatId] = {};
  await ctx.answerCbQuery('Возврат на главный экран...');
  try {
    await ctx.editMessageText('🏠 Домой. Выберите ваш ранг:', createRankKeyboard());
  } catch (_) {
    await ctx.reply('🏠 Домой. Выберите ваш ранг:', createRankKeyboard());
  }
});

// Action handler for rank selection
bot.action(/^rank_(.+)$/, async (ctx) => {
  const chatId = ctx.chat.id || ctx.from.id;
  const userId = ctx.from.id;
  userState[chatId] = userState[chatId] || {};

  const selectedRankKey = ctx.match[1];
  const rankUserChoiceText =
    Object.keys(RANK_USER_CHOICE_TO_KEY).find(
      (key) => RANK_USER_CHOICE_TO_KEY[key] === selectedRankKey
    ) || selectedRankKey;

  userState[chatId].rankUserChoiceText = rankUserChoiceText;
  userState[chatId].rankApiKey = selectedRankKey;

  delete userState[chatId].position;
  delete userState[chatId].heroes;
  delete userState[chatId].selectedHero;

  console.log(
    `👤 User ${userId} (ChatID: ${chatId}) selected rank: ${rankUserChoiceText} (API Key: ${selectedRankKey})`
  );
  await ctx.answerCbQuery(`Ранг: ${rankUserChoiceText}`);

  try {
    await ctx.editMessageText(
      `Ранг выбран: ${rankUserChoiceText}.\nТеперь выберите роль:`,
      createPositionKeyboard(chatId)
    );
  } catch (_) {
    await ctx.reply(
      `Ранг выбран: ${rankUserChoiceText}.\nТеперь выберите роль:`,
      createPositionKeyboard(chatId)
    );
  }
});

// Action handler for navigating back to position selection (from hero list)
bot.action('nav_back_to_positions', async (ctx) => {
  const chatId = ctx.chat.id || ctx.from.id;
  const state = userState[chatId] || {};
  console.log(
    `👤 User ${ctx.from.id} navigating back to position selection for rank ${state.rankUserChoiceText}`
  );
  await ctx.answerCbQuery('⬅️ Назад');

  if (!state.rankUserChoiceText || !state.rankApiKey) {
    // Ensure rankApiKey is also present for safety
    console.log('⚠️ Cannot go back to positions, rank info not in state. Going home.');
    await ctx.editMessageText('🏠 Домой. Выберите ваш ранг:', createRankKeyboard());
    return;
  }

  try {
    await ctx.editMessageText(
      `Ранг: ${state.rankUserChoiceText}.\nВыберите роль:`,
      createPositionKeyboard(chatId)
    );
  } catch (_) {
    await ctx.reply(
      `Ранг: ${state.rankUserChoiceText}.\nВыберите роль:`,
      createPositionKeyboard(chatId)
    );
  }
});

// Action handler for position selection
bot.action(/^pos_([A-Z0-9_]+)$/, async (ctx) => {
  const chatId = ctx.chat.id || ctx.from.id;
  const userId = ctx.from.id;
  const state = userState[chatId] || {};

  if (!state.rankApiKey || !state.rankUserChoiceText) {
    console.log('⚠️ Position selected but rank not in state. Navigating home.');
    await ctx.answerCbQuery('Ошибка: ранг не выбран. Начните сначала.', { show_alert: true });
    try {
      await ctx.editMessageText('🏠 Домой. Выберите ваш ранг:', createRankKeyboard());
    } catch (_) {
      await ctx.reply('🏠 Домой. Выберите ваш ранг:', createRankKeyboard());
    }
    return;
  }

  const selectedPositionKey = ctx.match[1];
  const positionName = POSITIONS[selectedPositionKey] || 'Неизвестная роль';

  state.position = selectedPositionKey;
  state.positionText = positionName; // Store for later display if needed
  delete state.heroes; // Clear previous hero list if any
  delete state.selectedHero;

  console.log(
    `👤 User ${userId} selected position: ${positionName} (key: ${selectedPositionKey}) for rank ${state.rankUserChoiceText}`
  );
  await ctx.answerCbQuery(`Роль: ${positionName}. Загружаю героев...`);

  let loadingMessage;
  try {
    // Edit the current message to show loading, or send a new one if not possible to edit (e.g., after an alert)
    const messageExists = ctx.callbackQuery.message;
    if (messageExists) {
      loadingMessage = await ctx.editMessageText('⏳ Формирую список героев...');
    } else {
      loadingMessage = await ctx.reply('⏳ Формирую список героев...');
    }
  } catch (editOrReplyError) {
    console.warn(
      '⚠️ Could not edit or send loading message, trying to send a new one if it was an edit error:',
      editOrReplyError.message
    );
    try {
      loadingMessage = await ctx.reply('⏳ Формирую список героев...');
    } catch (finalReplyError) {
      console.error('❌ Failed to send any loading message:', finalReplyError.message);
      // No return here, proceed to fetch data and try to send results, but UX will be degraded
    }
  }

  try {
    const topHeroes = await stratzService.fetchHeroStats(state.rankApiKey, [selectedPositionKey]);
    const processedHeroes = DataProcessor.processHeroStats(topHeroes);
    state.heroes = processedHeroes; // Store for potential back navigation

    if (!processedHeroes || processedHeroes.length === 0) {
      const noHeroesMessage = `Нет данных о героях для роли "${positionName}" на ранге "${state.rankUserChoiceText}". Попробуйте другие фильтры.`;
      if (loadingMessage) {
        await ctx.telegram.editMessageText(
          chatId,
          loadingMessage.message_id,
          undefined,
          noHeroesMessage,
          createHeroSelectionKeyboard(chatId, []) // Pass empty array for nav buttons
        );
      } else {
        await ctx.reply(noHeroesMessage, createHeroSelectionKeyboard(chatId, []));
      }
      return;
    }

    const heroNameColWidth = 21; // Остается 21
    const wrColWidth = 5; // Остается 5
    const matchesColWidth = 7; // Изменено на 7

    // Constructing the dynamic title (adding colon and extra newline)
    let tableTitle = `<b>Лучшие герои ${positionName} текущего патча на ранге ${state.rankUserChoiceText}:</b>\n\n`;

    let tableString = '<pre>';
    tableString += `${padString('Hero', heroNameColWidth)}|${padString('WR', wrColWidth)}|${padString('Matches', matchesColWidth)}\n`;
    // Adjusted dash lines to match content width
    tableString += `${'-'.repeat(heroNameColWidth)}|${'-'.repeat(wrColWidth)}|${'-'.repeat(matchesColWidth)}\n`;

    processedHeroes.forEach((h) => {
      const heroName = HERO_MAP[h.heroId] || `ID ${h.heroId}`;
      const winRateStr = h.winRate.toFixed(1) + '%';
      const matchesStr = String(h.matchCount);
      tableString += `${padString(heroName, heroNameColWidth)}|${padString(winRateStr, wrColWidth)}|${padString(matchesStr, matchesColWidth)}\n`;
    });
    tableString += '</pre>';

    const fullMessage = tableTitle + tableString + '\n';

    if (loadingMessage) {
      await ctx.telegram.editMessageText(
        chatId,
        loadingMessage.message_id,
        undefined,
        fullMessage,
        {
          parse_mode: 'HTML',
          ...createHeroSelectionKeyboard(chatId, processedHeroes),
        }
      );
    } else {
      await ctx.reply(fullMessage, {
        parse_mode: 'HTML',
        ...createHeroSelectionKeyboard(chatId, processedHeroes),
      });
    }
  } catch (error) {
    console.error('❌ Error in position selection action (fetching/processing heroes):', error);
    if (loadingMessage) {
      await ctx.telegram
        .deleteMessage(chatId, loadingMessage.message_id)
        .catch((e) => console.warn('Minor: Failed to delete loading message on error:', e.message));
    }
    await ctx.reply(
      'Произошла ошибка при загрузке героев. Попробуйте позже.',
      Markup.inlineKeyboard([Markup.button.callback('🏠 Домой', 'nav_home')])
    );
  }
});

// Action handler for hero selection
bot.action(/^hero_(\d+)$/, async (ctx) => {
  const chatId = ctx.chat.id || ctx.from.id;
  const userId = ctx.from.id;
  const state = userState[chatId] || {};

  if (!state.rankApiKey || !state.position || !state.heroes) {
    console.log(
      `⚠️ Hero selected but rank/position/heroes not in state for user ${userId}. Navigating home.`
    );
    await ctx.answerCbQuery('Ошибка: не найдены данные о ранге/роли. Начните сначала.', {
      show_alert: true,
    });
    try {
      // Attempt to edit the current message to go home.
      // This message was likely the hero selection prompt.
      await ctx.editMessageText('🏠 Домой. Выберите ваш ранг:', createRankKeyboard());
    } catch (_) {
      await ctx.reply('🏠 Домой. Выберите ваш ранг:', createRankKeyboard());
    }
    return;
  }

  const heroId = parseInt(ctx.match[1], 10);
  const selectedHeroObj = state.heroes.find((h) => h.heroId === heroId);
  const heroName =
    HERO_MAP[heroId] || (selectedHeroObj ? selectedHeroObj.name : `HeroID ${heroId}`);

  state.selectedHero = { id: heroId, name: heroName };
  delete state.buildType;

  console.log(
    `👤 User ${userId} (ChatID: ${chatId}) selected hero: ${heroName} (ID: ${heroId}) for rank ${state.rankUserChoiceText}, pos ${state.position}`
  );
  await ctx.answerCbQuery(`Герой: ${heroName}`);

  // Ширины столбцов для таблицы информации о герое
  const rankColHeroInfo = 9; // Новая ширина
  const roleColHeroInfo = 18; // Новая ширина
  const wrColHeroInfo = 5; // Новая ширина

  const rankName = state.rankUserChoiceText || 'N/A';
  const roleName = state.positionText || POSITIONS[state.position] || 'N/A';
  const winRate =
    selectedHeroObj && typeof selectedHeroObj.winRate === 'number'
      ? selectedHeroObj.winRate.toFixed(1) + '%'
      : 'N/A';

  // Форматируем данные для таблицы
  const paddedRank = padString(rankName, rankColHeroInfo);
  const paddedRole = padString(roleName, roleColHeroInfo);
  const paddedWR = padString(winRate, wrColHeroInfo);

  // Собираем таблицу
  let heroInfoTable = '<pre>';
  heroInfoTable += `${padString('Rank', rankColHeroInfo)}|${padString('Role', roleColHeroInfo)}|${padString('WR', wrColHeroInfo)}\n`;
  heroInfoTable += `${'-'.repeat(rankColHeroInfo)}|${'-'.repeat(roleColHeroInfo)}|${'-'.repeat(wrColHeroInfo)}\n`;
  heroInfoTable += `${paddedRank}|${paddedRole}|${paddedWR}\n`;
  heroInfoTable += '</pre>';

  const messageText = `Вы выбрали героя <b>${heroName}</b>:\n\n${heroInfoTable}\n\nТеперь вы можете посмотреть лучшие предметы для <b>${heroName}</b>, нажав на <b>Предметы</b>, и последовательность изучения навыков героя, нажав на <b>Навыки</b>.`;

  try {
    await ctx.editMessageText(messageText, {
      ...createBuildChoiceKeyboard(chatId, heroId),
      parse_mode: 'HTML',
    });
  } catch (error) {
    console.error('Error editing message for build choice selection:', error);
    // If editing fails, try to send a new message as a fallback.
    await ctx.replyWithHTML(messageText, createBuildChoiceKeyboard(chatId, heroId));
  }
});

// Action handler for navigating back to hero selection (from build choice)
bot.action('nav_back_to_heroes', async (ctx) => {
  const chatId = ctx.chat.id || ctx.from.id;
  const state = userState[chatId] || {};

  if (!state.rankApiKey || !state.position || !state.heroes) {
    console.log(
      `⚠️ User ${ctx.from.id} tried to nav_back_to_heroes but state is incomplete. Going home.`
    );
    await ctx.answerCbQuery('Не удалось вернуться. Начните сначала.', { show_alert: true });
    try {
      await ctx.editMessageText('🏠 Домой. Выберите ваш ранг:', createRankKeyboard());
    } catch (_) {
      await ctx.reply('🏠 Домой. Выберите ваш ранг:', createRankKeyboard());
    }
    return;
  }

  console.log(
    `👤 User ${ctx.from.id} navigating back to hero selection for rank ${state.rankUserChoiceText}, pos ${state.position}`
  );
  await ctx.answerCbQuery('⬅️ Назад к выбору героя');

  // The message to edit is the one currently showing build choices.
  // We need to change its content to "Выберите героя:" and its keyboard to the hero selection keyboard.
  // The hero list with stats (the message above this one) remains untouched.
  try {
    await ctx.editMessageText('Выберите героя:', createHeroSelectionKeyboard(chatId, state.heroes));
  } catch (error) {
    console.error('Error editing message for nav_back_to_heroes:', error);
    // Fallback: if editing fails, send a new message. This might clutter chat but is better than no response.
    await ctx.reply('Выберите героя:', createHeroSelectionKeyboard(chatId, state.heroes));
  }
});

// Action handler for item build selection
bot.action(/^build_item_(\d+)$/, async (ctx) => {
  const chatId = ctx.chat.id || ctx.from.id;
  const userId = ctx.from.id;
  const state = userState[chatId] || {};
  const heroIdFromAction = parseInt(ctx.match[1], 10);

  if (
    !state.rankApiKey ||
    !state.position ||
    !state.selectedHero ||
    state.selectedHero.id !== heroIdFromAction
  ) {
    console.log(
      `⚠️ Item build request for hero ${heroIdFromAction} but state is inconsistent or hero mismatch for user ${userId}. State: ${JSON.stringify(state.selectedHero)} Navigating home.`
    );
    await ctx.answerCbQuery('Ошибка: данные сессии устарели. Начните сначала.', {
      show_alert: true,
    });
    try {
      await ctx.editMessageText('🏠 Домой. Выберите ваш ранг:', createRankKeyboard());
    } catch (_) {
      await ctx.reply('🏠 Домой. Выберите ваш ранг:', createRankKeyboard());
    }
    return;
  }

  const { rankApiKey, position, selectedHero, rankUserChoiceText } = state;
  const heroName = selectedHero.name;

  console.log(
    `🎒 User ${userId} requested item build for ${heroName} (ID: ${selectedHero.id}), Rank: ${rankUserChoiceText}, Pos: ${position}`
  );
  await ctx.answerCbQuery(`🎒 Итембилд для ${heroName}. Загружаю...`);

  let loadingMessage;
  try {
    loadingMessage = await ctx.reply(`⏳ Загружаю итембилд для героя ${heroName}...`);
  } catch (replyError) {
    console.error('❌ Error sending loading placeholder message for item build:', replyError);
    await ctx.answerCbQuery('Ошибка отображения. Попробуйте снова.', { show_alert: true });
    return;
  }

  try {
    const itemBuildData = await stratzService.fetchItemBuild(selectedHero.id, rankApiKey, [
      position,
    ]);

    if (
      !itemBuildData ||
      typeof itemBuildData !== 'object' ||
      Object.keys(itemBuildData).length === 0
    ) {
      console.log(
        `⚠️ No item build data returned for ${heroName}, Rank: ${rankUserChoiceText}, Pos: ${position}`
      );
      const noDataText = `Не найдено данных по итембилду для героя ${heroName} (Ранг: ${rankUserChoiceText}, Роль: ${POSITIONS[position]}).`;
      await ctx.telegram.editMessageText(chatId, loadingMessage.message_id, undefined, noDataText);
    } else {
      const processedResult = DataProcessor.processItemBuild(
        itemBuildData,
        ITEM_MAP,
        heroName,
        rankUserChoiceText,
        POSITIONS[position]
      );
      await ctx.telegram.editMessageText(
        chatId,
        loadingMessage.message_id,
        undefined,
        processedResult.message,
        { parse_mode: processedResult.parse_mode || 'MarkdownV2' }
      );
    }
  } catch (error) {
    console.error(`❌ Error fetching or processing item build for ${heroName}:`, error);
    const errorText = `Произошла ошибка при загрузке итембилда для героя ${heroName}.`;
    try {
      await ctx.telegram.editMessageText(chatId, loadingMessage.message_id, undefined, errorText);
    } catch (editError) {
      console.warn('Failed to edit loading message for item build error:', editError);
      await ctx.telegram
        .deleteMessage(chatId, loadingMessage.message_id)
        .catch((delErr) =>
          console.warn('Failed to delete loading msg after item build error', delErr)
        );
      await ctx.reply(errorText);
    }
  }
  const newPromptText = `Выбор билда для ${heroName} (Ранг: ${rankUserChoiceText}, Роль: ${POSITIONS[position]}):`;
  await ctx.reply(newPromptText, createBuildChoiceKeyboard(chatId, selectedHero.id));
});

// NEW HELPER FUNCTION for skill build aggregation and formatting
function processAndFormatSkillBuildData(
  skillPointEventsByMatch,
  targetHeroId,
  positionKey,
  heroName,
  rankUserChoiceText,
  abilityMapFromBot
) {
  const skillCountsByLevel = {};
  const matchCount = skillPointEventsByMatch.length;

  if (matchCount === 0) {
    return {
      message: `<b>🚫 Нет данных о сборках навыков для ${escapeHTML(heroName)} на позиции ${escapeHTML(POSITIONS[positionKey] || positionKey)} для ранга ${escapeHTML(rankUserChoiceText)}.</b>\nВозможно, не найдено достаточного количества недавних матчей.`,
      parse_mode: 'HTML',
    };
  }

  const MAX_HERO_LEVEL_FOR_SKILL_COUNTS = 12;
  const TARGET_BUILD_DISPLAY_LEVEL = 9;

  skillPointEventsByMatch.forEach((matchData) => {
    if (!matchData || !matchData.skillPoints || !Array.isArray(matchData.skillPoints)) return;
    matchData.skillPoints.forEach((skillPoint) => {
      if (skillPoint.heroLevel <= MAX_HERO_LEVEL_FOR_SKILL_COUNTS) {
        if (!skillCountsByLevel[skillPoint.heroLevel]) {
          skillCountsByLevel[skillPoint.heroLevel] = {};
        }
        skillCountsByLevel[skillPoint.heroLevel][skillPoint.abilityId] =
          (skillCountsByLevel[skillPoint.heroLevel][skillPoint.abilityId] || 0) + 1;
      }
    });
  });

  const mostPopularBuild = [];
  const popularityStats = [];
  const currentBuildSkillLevels = {};

  for (let level = 1; level <= TARGET_BUILD_DISPLAY_LEVEL; level++) {
    let chosenAbilityId = null;
    let maxCountForChosenAbility = 0;
    let totalPicksAtThisHeroLevel = 0;

    if (skillCountsByLevel[level]) {
      const abilitiesAtThisLevel = skillCountsByLevel[level];
      totalPicksAtThisHeroLevel = Object.values(abilitiesAtThisLevel).reduce(
        (sum, count) => sum + count,
        0
      );

      const sortedAbilities = Object.entries(abilitiesAtThisLevel)
        .sort(([, countA], [, countB]) => countB - countA)
        .map(([id]) => parseInt(id, 10));

      for (const abilityId of sortedAbilities) {
        const abilityInfo = abilityMapFromBot[abilityId];
        if (
          !abilityInfo ||
          (abilityInfo.stat && abilityInfo.stat.isTalent) ||
          abilityInfo.isTalent ||
          typeof abilityInfo.maxLevel === 'undefined'
        )
          continue;

        const currentPointsInThisSkill = currentBuildSkillLevels[abilityId] || 0;
        if (currentPointsInThisSkill < abilityInfo.maxLevel) {
          chosenAbilityId = abilityId;
          maxCountForChosenAbility = abilitiesAtThisLevel[abilityId];
          break;
        }
      }
    }

    mostPopularBuild.push(chosenAbilityId);
    if (chosenAbilityId) {
      currentBuildSkillLevels[chosenAbilityId] =
        (currentBuildSkillLevels[chosenAbilityId] || 0) + 1;
    }

    popularityStats.push({
      level: level,
      abilityId: chosenAbilityId,
      count: chosenAbilityId ? maxCountForChosenAbility : 0,
      totalAtLevel: totalPicksAtThisHeroLevel,
    });
  }

  const messageParts = [];
  const heroNameHTML = escapeHTML(heroName || 'выбранного героя');
  const rankTextHTML = escapeHTML(rankUserChoiceText || 'Про игроки');
  const positionHTML = escapeHTML(POSITIONS[positionKey] || positionKey);

  messageParts.push(`<b>📘 Рекомендуемый скиллбилд для ${heroNameHTML}</b>`);
  messageParts.push(`<b>Ранг: ${rankTextHTML}</b>`);
  messageParts.push(`<b>Позиция: ${positionHTML}</b>`);
  messageParts.push(`(На основе ${matchCount} матчей)`);

  const levelColWidth = 4;
  const skillColWidth = 28;
  const pickRateColWidth = 10;
  const tableContentHeader = `Lvl | ${padString('Навык', skillColWidth)} | ${padString('Выборы', pickRateColWidth)}`;
  const tableSeparator = `${'-'.repeat(levelColWidth)}+${'-'.repeat(skillColWidth + 2)}+${'-'.repeat(pickRateColWidth + 1)}`;

  messageParts.push(`<b>Самые популярные навыки по уровням (1-${TARGET_BUILD_DISPLAY_LEVEL}):</b>`);
  messageParts.push('<pre>');
  messageParts.push(tableContentHeader);
  messageParts.push(tableSeparator);

  for (let i = 0; i < TARGET_BUILD_DISPLAY_LEVEL; i++) {
    const levelData = popularityStats[i];
    const levelDisplay = padString(levelData.level.toString(), levelColWidth - 1);
    const abilityId = levelData.abilityId;
    const abilityInfo = abilityId && abilityMapFromBot ? abilityMapFromBot[abilityId] : null;

    let abilityNameText = '-нет данных-';
    if (abilityInfo) {
      let namePart =
        abilityInfo.dname || abilityInfo.displayName || abilityInfo.name || `ID ${abilityId}`;
      abilityNameText = namePart;
      const hotkeyToDisplay = abilityInfo.hotKeyOverride || abilityInfo.hotKey;
      if (hotkeyToDisplay && hotkeyToDisplay !== 'N/A') {
        abilityNameText += ` (${hotkeyToDisplay})`;
      }
    } else if (abilityId) {
      abilityNameText = `ID ${abilityId}`;
    }

    abilityNameText = padString(abilityNameText, skillColWidth);
    const pickStat = abilityId ? `${levelData.count}/${levelData.totalAtLevel}` : '-';
    messageParts.push(
      `${levelDisplay} | ${abilityNameText} | ${padString(pickStat, pickRateColWidth)}`
    );
  }
  messageParts.push('</pre>');
  messageParts.push(
    '\n<i>Примечание: Билд основан на статистике последних матчей профессиональных игроков.</i>'
  );

  return {
    message: messageParts.join('\n'),
    parse_mode: 'HTML',
    cacheData: {
      timestamp: Date.now(),
      heroId: targetHeroId,
      positionKey: positionKey,
      skillCountsByLevel: skillCountsByLevel,
      mostPopularBuild: mostPopularBuild,
      popularityStats: popularityStats,
      matchCount: matchCount,
    },
  };
}

bot.action(/^build_skill_(.+)$/, async (ctx) => {
  const chatId = ctx.chat.id || ctx.from.id;
  const userId = ctx.from.id;
  await ctx.answerCbQuery('Загрузка сборки навыков...');

  if (!userState[chatId] || !userState[chatId].selectedHero) {
    await ctx.reply('Ошибка: Не найден выбранный герой. Пожалуйста, начните сначала /start.');
    console.error(
      `[SkillBuild Action] Error: User ${userId} (ChatID: ${chatId}) - selectedHero not found in state.`
    );
    return;
  }

  const targetHeroId = parseInt(ctx.match[1], 10);
  // Ensure selectedHero and its properties exist
  if (!userState[chatId].selectedHero || !userState[chatId].selectedHero.name) {
    await ctx.reply(
      'Ошибка: Данные о выбранном герое неполные. Пожалуйста, выберите героя заново.'
    );
    console.error(
      `[SkillBuild Action] Error: User ${userId} (ChatID: ${chatId}) - selectedHero object or selectedHero.name missing.`
    );
    return;
  }

  if (!userState[chatId].position) {
    await ctx.reply(
      'Ошибка: Данные о выбранной позиции не найдены. Пожалуйста, вернитесь к выбору позиции.'
    );
    console.error(
      `[SkillBuild Action] Error: User ${userId} (ChatID: ${chatId}) - userState.position missing.`
    );
    return;
  }

  const heroName = userState[chatId].selectedHero.name;
  const positionKey = userState[chatId].position; // Correctly sourced from userState.position
  const rankUserChoiceText = userState[chatId].rankUserChoiceText || 'Про игроки';

  if (!positionKey) {
    await ctx.reply(
      'Ошибка: Не выбрана позиция для героя. Пожалуйста, вернитесь к выбору позиции.'
    );
    console.error(
      `[SkillBuild Action] Error: User ${userId} (ChatID: ${chatId}) - positionKey not found for hero ${heroName}.`
    );
    return;
  }

  console.log(
    `[SkillBuild Action] User ${userId} (ChatID: ${chatId}) requested skill build for Hero ID: ${targetHeroId} (${heroName}), Position: ${positionKey}, Rank: ${rankUserChoiceText}.`
  );

  const cacheFileName = `${targetHeroId}-${positionKey}.json`;
  const cacheFilePath = path.join(SKILL_BUILD_CACHE_DIR, cacheFileName);

  try {
    const cachedDataRaw = await fs.readFile(cacheFilePath, 'utf-8').catch(() => null);
    if (cachedDataRaw) {
      const cachedBuildData = JSON.parse(cachedDataRaw);
      if (Date.now() - cachedBuildData.timestamp < SKILL_BUILD_CACHE_EXPIRY_MS) {
        console.log(
          `[SkillBuild Action] Cache hit for ${heroName} - ${positionKey}. Formatting from cached data.`
        );

        // Используем существующую функцию для форматирования, передавая кешированные агрегированные данные
        // Это требует, чтобы processAndFormatSkillBuildData могла работать с уже агрегированными данными,
        // либо нам нужна отдельная функция форматирования.
        // Текущая processAndFormatSkillBuildData ожидает skillPointEventsByMatch.
        // Переделываем логику кеша, чтобы вызывать processAndFormatSkillBuildData только один раз.

        const messageParts = [];
        const heroNameHTML = escapeHTML(heroName || 'выбранного героя');
        const rankTextHTML = escapeHTML(rankUserChoiceText || 'Про игроки');
        const positionHTML = escapeHTML(POSITIONS[positionKey] || positionKey);
        const TARGET_BUILD_DISPLAY_LEVEL = 9;

        messageParts.push(`<b>📘 Рекомендуемый скиллбилд для ${heroNameHTML}</b> (кеш)`);
        messageParts.push(`<b>Ранг: ${rankTextHTML}</b>`);
        messageParts.push(`<b>Позиция: ${positionHTML}</b>`);
        messageParts.push(`(На основе ${cachedBuildData.matchCount} матчей)`);

        const levelColWidth = 4;
        const skillColWidth = 28;
        const pickRateColWidth = 10;
        const tableContentHeader = `Lvl | ${padString('Навык', skillColWidth)} | ${padString('Выборы', pickRateColWidth)}`;
        const tableSeparator = `${padString('-', levelColWidth, '-')}+${padString('-', skillColWidth + 2, '-')}+${padString('-', pickRateColWidth + 1, '-')}`;

        messageParts.push(
          `<b>Самые популярные навыки по уровням (1-${TARGET_BUILD_DISPLAY_LEVEL}):</b>`
        );
        messageParts.push('<pre>');
        messageParts.push(tableContentHeader);
        messageParts.push(tableSeparator);

        for (let i = 0; i < TARGET_BUILD_DISPLAY_LEVEL; i++) {
          const levelData = cachedBuildData.popularityStats[i];
          const levelDisplay = padString(levelData.level.toString(), levelColWidth - 1);
          const abilityId = levelData.abilityId;
          const abilityInfo = abilityId && ABILITY_MAP ? ABILITY_MAP[abilityId] : null;

          let abilityNameText = '-нет данных-';
          if (abilityInfo) {
            let namePart =
              abilityInfo.dname || abilityInfo.displayName || abilityInfo.name || `ID ${abilityId}`;
            abilityNameText = namePart;
            const hotkeyToDisplay = abilityInfo.hotKeyOverride || abilityInfo.hotKey;
            if (hotkeyToDisplay && hotkeyToDisplay !== 'N/A') {
              abilityNameText += ` (${hotkeyToDisplay})`;
            }
          } else if (abilityId) {
            abilityNameText = `ID ${abilityId}`;
          }

          abilityNameText = padString(abilityNameText, skillColWidth);
          const pickStat = abilityId ? `${levelData.count}/${levelData.totalAtLevel}` : '-';
          messageParts.push(
            `${levelDisplay} | ${abilityNameText} | ${padString(pickStat, pickRateColWidth)}`
          );
        }
        messageParts.push('</pre>');
        messageParts.push(
          '\n<i>Примечание: Билд основан на статистике последних матчей профессиональных игроков.</i>'
        );

        await ctx.editMessageText(messageParts.join('\n'), { parse_mode: 'HTML' });
        return;
      } else {
        console.log(
          `[SkillBuild Action] Cache stale for ${heroName} - ${positionKey}. Fetching fresh data.`
        );
      }
    }
  } catch (error) {
    console.warn(
      `[SkillBuild Action] Error reading or parsing cache for ${heroName} - ${positionKey}:`,
      error.message
    );
  }

  try {
    await ctx.editMessageText(
      `⏳ Загружаю актуальную сборку навыков для ${escapeHTML(heroName)} на позиции ${escapeHTML(POSITIONS[positionKey] || positionKey)}...`,
      { parse_mode: 'HTML' }
    );

    const skillPointEventsByMatch = await stratzService.fetchRecentProMatches(
      [targetHeroId],
      positionKey
    );

    if (!skillPointEventsByMatch) {
      // Check for null or undefined specifically
      console.log(
        `[SkillBuild Action] StratzService.fetchRecentProMatches returned null/undefined for Hero ${targetHeroId}, Pos ${positionKey}.`
      );
      await ctx.editMessageText(
        `🚫 Не удалось получить данные о сборке навыков для ${escapeHTML(heroName)} на позиции ${escapeHTML(POSITIONS[positionKey] || positionKey)}.`,
        { parse_mode: 'HTML' }
      );
      return;
    }
    // If skillPointEventsByMatch is an empty array, processAndFormatSkillBuildData will handle it.

    console.log(
      `[SkillBuild Action] Received ${skillPointEventsByMatch.length} processed match objects from fetchRecentProMatches.`
    );

    const result = processAndFormatSkillBuildData(
      skillPointEventsByMatch,
      targetHeroId,
      positionKey,
      heroName,
      rankUserChoiceText,
      ABILITY_MAP
    );

    if (result.cacheData) {
      try {
        await fs.writeFile(cacheFilePath, JSON.stringify(result.cacheData, null, 2), 'utf-8');
        console.log(
          `[SkillBuild Action] Skill build data for ${heroName} - ${positionKey} saved to cache.`
        );
      } catch (cacheError) {
        console.error(
          `[SkillBuild Action] Error writing skill build data to cache for ${heroName} - ${positionKey}:`,
          cacheError.message
        );
      }
    }

    await ctx.editMessageText(result.message, { parse_mode: result.parse_mode });
  } catch (error) {
    console.error(
      `[SkillBuild Action] Critical error fetching or processing skill build for ${heroName} - ${positionKey}:`,
      error
    );
    await ctx.editMessageText(
      `❌ Произошла серьезная ошибка при получении сборки навыков для ${escapeHTML(heroName)}. Пожалуйста, попробуйте позже.`,
      { parse_mode: 'HTML' }
    );
  }
});

// --- Function for Cache Warming ---
async function warmUpSkillBuildCache() {
  console.log('[CacheWarmer] Starting skill build cache warmup...');
  if (!stratzService || !stratzService.isInitialized()) {
    console.error(
      '[CacheWarmer] StratzService is not available or not initialized. Skipping warmup.'
    );
    return;
  }

  const targets = await stratzService.fetchTopHeroesByPositionForCacheWarmup('pro', 2);

  if (!targets || targets.length === 0) {
    console.log('[CacheWarmer] No target heroes found for cache warmup.');
    return;
  }

  console.log(`[CacheWarmer] Warming up cache for ${targets.length} hero/position pairs.`);
  const rankUserChoiceTextForCache = 'Про игроки';

  for (const target of targets) {
    const { heroId, positionKey, heroName } = target;
    console.log(
      `[CacheWarmer] Processing: Hero ${heroName} (ID: ${heroId}), Position: ${positionKey}`
    );

    const cacheFileName = `${heroId}-${positionKey}.json`;
    const cacheFilePath = path.join(SKILL_BUILD_CACHE_DIR, cacheFileName);

    try {
      const skillPointEventsByMatch = await stratzService.fetchRecentProMatches(
        [heroId],
        positionKey
      );

      if (!skillPointEventsByMatch || skillPointEventsByMatch.length === 0) {
        console.log(
          `[CacheWarmer] No skill build data from StratzService for ${heroName} - ${positionKey}. Skipping.`
        );
        continue;
      }

      const result = processAndFormatSkillBuildData(
        skillPointEventsByMatch,
        heroId,
        positionKey,
        heroName,
        rankUserChoiceTextForCache,
        ABILITY_MAP
      );

      if (result.cacheData) {
        await fs.writeFile(cacheFilePath, JSON.stringify(result.cacheData, null, 2), 'utf-8');
        console.log(
          `[CacheWarmer] Successfully cached skill build for ${heroName} - ${positionKey}.`
        );
      } else {
        console.log(
          `[CacheWarmer] No cacheData produced for ${heroName} - ${positionKey}. Message: ${result.message}`
        );
      }
    } catch (error) {
      console.error(
        `[CacheWarmer] Error warming up cache for ${heroName} - ${positionKey}:`,
        error.message
      );
    }

    const delayMs = 3000;
    console.log(`[CacheWarmer] Waiting ${delayMs / 1000}s before next target...`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  console.log('[CacheWarmer] Skill build cache warmup finished.');
}

// Error handler (This might be a duplicate if you restored it, ensure only one exists)
bot.catch((err, ctx) => {
  console.error(`❌ Telegraf error for ${ctx.updateType}`, err);
  if (ctx.callbackQuery) {
    ctx
      .answerCbQuery('Произошла ошибка. Попробуйте снова.', { show_alert: true })
      .catch((e) => console.error('Failed to answerCbQuery on general error', e));
  } else if (ctx.chat && ctx.chat.id) {
    ctx
      .reply('Произошла ошибка. Пожалуйста, попробуйте позже или начните сначала с /start')
      .catch((e) => console.error('Failed to reply on general error', e));
  } else {
    console.error("❌ Telegraf error couldn't be sent to user - no callbackQuery or chat context");
  }
});

// Start the bot
async function startBot() {
  try {
    await ensureCacheDirExists();
    await initializeBot();
    console.log('✅ Bot initialized, setting commands...');
    await bot.telegram.setMyCommands([
      { command: 'start', description: 'Запустить бота' },
      // { command: 'menu', description: '📖 Показать главное меню' },
      // { command: 'settings', description: '⚙️ Настройки (если будут)' },
      // { command: 'help', description: '❓ Помощь' }
    ]);
    console.log('✅ Bot commands set successfully.');

    bot
      .launch()
      .then(() => {
        console.log('🟢 Bot started successfully!');

        cron.schedule(
          '0 3 * * *',
          () => {
            // Daily at 3:00 AM server time
            console.log('[Scheduler] Running daily cache warmup job (3:00 AM Server Time)...');
            warmUpSkillBuildCache().catch((err) => {
              console.error('[Scheduler] Error during scheduled cache warmup:', err);
            });
          },
          {
            // timezone: "Europe/Moscow" // Optional: specify timezone
          }
        );
        console.log('[Scheduler] Daily cache warmup job scheduled for 3:00 AM server time.');

        // Optional: Initial warmup on startup for testing
        // console.log('[Scheduler] Performing initial cache warmup on startup...');
        // warmUpSkillBuildCache().catch(err => {
        //   console.error('[Scheduler] Error during initial cache warmup on startup:', err);
        // });
      })
      .catch((err) => {
        console.error('🔴 Bot failed to launch:', err);
        process.exit(1);
      });
  } catch (error) {
    console.error('🔴 Failed to start bot during initialization or command setting:', error);
    process.exit(1);
  }
}

startBot();

// Graceful shutdown
process.once('SIGINT', () => {
  console.log('SIGINT received, stopping bot...');
  bot.stop('SIGINT');
  process.exit(0);
});
process.once('SIGTERM', () => {
  console.log('SIGTERM received, stopping bot...');
  bot.stop('SIGTERM');
  process.exit(0);
});
