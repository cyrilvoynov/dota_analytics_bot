require('dotenv').config({ path: __dirname + '/.env' });
const { Telegraf, Markup } = require('telegraf');
const { StratzService } = require('./src/services/stratzService');
const { DataProcessor } = require('./src/utils/dataProcessor');

const BOT_TOKEN = process.env.BOT_TOKEN;
const bot = new Telegraf(BOT_TOKEN);

// Константы для фильтрации
const DAYS_TO_ANALYZE = 8;
const MIN_MMR = 7000;
const MAX_MMR = 8500;

const POSITIONS = {
  POSITION_1: '🗡️ Safe Lane',
  POSITION_2: '🏹 Mid Lane',
  POSITION_3: '🛡️ Off Lane',
  POSITION_4: '🪄 Support',
  POSITION_5: '❤️‍🩹 Hard Support',
};

let HERO_MAP = {};
let ABILITY_MAP = {};
let ITEM_MAP = {};
const userState = {};

async function preloadConstants() {
  try {
    const constants = await StratzService.fetchConstants();
    const maps = DataProcessor.processGameConstants(constants);
    HERO_MAP = maps.HERO_MAP;
    ABILITY_MAP = maps.ABILITY_MAP;
    ITEM_MAP = maps.ITEM_MAP;
    console.log('✅ Constants loaded successfully');
  } catch (error) {
    console.error('❌ Error loading constants:', error);
    throw error;
  }
}

// Функции отображения интерфейса
function showPositionSelection(ctx) {
  userState[ctx.chat.id] = {};
  return ctx.reply(
    'Выберите роль для анализа статистики (7000-8500 MMR, последние 8 дней):',
    Markup.keyboard([
      ['POSITION_1', 'POSITION_2'],
      ['POSITION_3', 'POSITION_4'],
      ['POSITION_5'],
      ['⬅️ Назад', '🏠 Домой'],
    ]).resize()
  );
}

function showHeroList(ctx, heroes) {
  const buttons = heroes.map((h) => [HERO_MAP[h.heroId]]);
  buttons.push(['⬅️ Назад', '🏠 Домой']);
  return ctx.reply('Выберите героя из списка:', Markup.keyboard(buttons).resize());
}

function showHeroActions(ctx, heroName) {
  return ctx.reply(
    `✅ Герой выбран: ${heroName}`,
    Markup.keyboard([
      ['📘 Скиллбилд', '🎒 Предметы'],
      ['⬅️ Назад', '🏠 Домой'],
    ]).resize()
  );
}

// Команды и навигация
bot.command('start', showPositionSelection);

bot.hears('⬅️ Назад', (ctx) => {
  console.log('Back button pressed');
  const state = userState[ctx.chat.id] || {};

  if (state.selectedHero) {
    delete state.selectedHero;
    return showHeroList(ctx, state.heroes);
  }

  if (state.heroes) {
    delete state.heroes;
    delete state.position;
    return showPositionSelection(ctx);
  }

  return showPositionSelection(ctx);
});

bot.hears('🏠 Домой', (ctx) => {
  console.log('Home button pressed');
  userState[ctx.chat.id] = {};
  return showPositionSelection(ctx);
});

// Обработчик выбора позиции
bot.hears(['POSITION_1', 'POSITION_2', 'POSITION_3', 'POSITION_4', 'POSITION_5'], async (ctx) => {
  const chatId = ctx.chat.id;
  const position = ctx.message.text;

  console.log(`Position selected: ${position}`);

  try {
    console.log(`🔄 Fetching stats for position ${position} (MMR ${MIN_MMR}-${MAX_MMR})`);
    const stats = await StratzService.fetchHeroStats(['DIVINE_IMMORTAL'], [position], {
      minMmr: MIN_MMR,
      maxMmr: MAX_MMR,
      daysBack: DAYS_TO_ANALYZE,
    });

    if (!stats || stats.length === 0) {
      console.log('⚠️ No stats returned from API');
      return ctx.reply('Не удалось получить статистику. Попробуйте позже.');
    }

    const topHeroes = DataProcessor.processHeroStats(stats);

    if (!topHeroes || topHeroes.length === 0) {
      console.log('⚠️ No heroes found after processing');
      return ctx.reply('Не найдено героев с достаточным количеством матчей для этой роли.');
    }

    userState[chatId].heroes = topHeroes;
    userState[chatId].position = position;

    const message = [
      `📊 Статистика за последние ${DAYS_TO_ANALYZE} дней`,
      `🎯 MMR: ${MIN_MMR}-${MAX_MMR}`,
      `Роль: ${POSITIONS[position]}`,
      '',
      ...topHeroes.map((h, i) => {
        const date = new Date(h.day * 1000);
        const dateStr = date.toLocaleDateString('ru-RU', {
          day: 'numeric',
          month: 'long',
        });

        const winrateStr =
          h.winRate !== null ? `📈 Винрейт: ${h.winRate.toFixed(1)}%` : '⚠️ Нет данных о винрейте';

        return [
          `${i + 1}. ${HERO_MAP[h.heroId]}`,
          `${winrateStr} (${h.matchCount} игр за ${dateStr})`,
          '',
        ].join('\n');
      }),
    ].join('\n');

    await ctx.reply(message);
    return showHeroList(ctx, topHeroes);
  } catch (error) {
    console.error('❌ Error fetching hero stats:', error);
    return ctx.reply('Произошла ошибка при получении статистики. Попробуйте позже.');
  }
});

// Обработчик выбора героя
bot.hears(/^[А-Яа-яёЁA-Za-z\s-]+$/, async (ctx) => {
  const chatId = ctx.chat.id;
  const heroName = ctx.message.text;

  // Проверяем, не является ли текст кнопкой навигации
  if (heroName === '⬅️ Назад' || heroName === '🏠 Домой') {
    return;
  }

  const heroEntry = Object.entries(HERO_MAP).find(([_id, name]) => name === heroName);

  if (!heroEntry) return;

  console.log(`Hero selected: ${heroName}`);
  const heroId = Number(heroEntry[0]);
  userState[chatId].selectedHero = heroId;

  return showHeroActions(ctx, HERO_MAP[heroId]);
});

// Обработчики действий с героем
bot.hears('📘 Скиллбилд', async (ctx) => {
  const chatId = ctx.chat.id;
  const { selectedHero, position } = userState[chatId];

  if (!selectedHero || !position) {
    return showPositionSelection(ctx);
  }

  try {
    const abilities = await StratzService.fetchAbilityBuild(
      selectedHero,
      ['DIVINE_IMMORTAL'],
      [position],
      {
        minMmr: MIN_MMR,
        maxMmr: MAX_MMR,
        daysBack: DAYS_TO_ANALYZE,
      }
    );

    const processed = DataProcessor.processAbilityBuild(abilities, HERO_MAP, ABILITY_MAP);

    if (!processed || processed.length === 0) {
      return ctx.reply('Не найдено данных о скиллбилде для этого героя.');
    }

    const message = [
      `📘 Скиллбилд для ${HERO_MAP[selectedHero]}:`,
      '',
      ...processed.map(
        (a) => `🔹 ${a.abilityName} на уровне ${a.level} (${a.matchCount} игр, WR: ${a.winRate}%)`
      ),
    ].join('\n');

    return ctx.reply(message);
  } catch (error) {
    console.error('❌ Error fetching ability build:', error);
    return ctx.reply('Произошла ошибка при получении скиллбилда. Попробуйте позже.');
  }
});

bot.hears('🎒 Предметы', async (ctx) => {
  const chatId = ctx.chat.id;
  const { selectedHero, position } = userState[chatId];

  if (!selectedHero || !position) {
    return showPositionSelection(ctx);
  }

  try {
    const items = await StratzService.fetchItemBuild(
      selectedHero,
      ['DIVINE_IMMORTAL'],
      [position],
      {
        minMmr: MIN_MMR,
        maxMmr: MAX_MMR,
        daysBack: DAYS_TO_ANALYZE,
      }
    );

    const processed = DataProcessor.processItemBuild(items, ITEM_MAP);

    if (!processed || processed.length === 0) {
      return ctx.reply('Не найдено данных о предметах для этого героя.');
    }

    const message = [
      `🎒 Предметы для ${HERO_MAP[selectedHero]}:`,
      '',
      ...processed.map(
        (i) =>
          `🔸 ${i.itemName} — ${i.avgTime}мин (чаще всего: ${i.mostCommonTime}мин) | WR: ${i.winRate}% (${i.matchCount} игр)`
      ),
    ].join('\n');

    return ctx.reply(message);
  } catch (error) {
    console.error('❌ Error fetching item build:', error);
    return ctx.reply('Произошла ошибка при получении предметов. Попробуйте позже.');
  }
});

preloadConstants().then(() => bot.launch());
