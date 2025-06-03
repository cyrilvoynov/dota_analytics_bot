// const UNKNOWN_ABILITY_ID = -1; // Removed as unused by ESLint
console.log('[[[DataProcessor MODULE EXECUTION MARKER - V3]]]'); // NEW MARKER
// const { escapeHTML } = require('./messageUtils');

// Define these at a higher scope or import if they become extensive
const ABILITIES_TO_FILTER_OUT = [
  730, // Old bonus attributes (already filtered in some places, but good to consolidate)
  1392, // generic_hidden / attribute_bonus_deprecated seen in logs
  // Add any other known generally non-skillable ability IDs here
];
const LOW_ID_TALENTS_TO_FILTER = [
  // This list should contain low numerical ID abilities that are actually talents
  // if the primary talent filtering (ID > 5900) is not sufficient.
  // Example: Some very old or special talents might have low IDs.
  // For now, this is kept as a placeholder for robustness.
  // 730, // Old +2 Attributes - already in NON_SKILL_ABILITY_IDS
];

// const MAX_LEVEL_TO_CONSIDER = 12; // Defined in the class or globally
// const TARGET_BUILD_LEVEL = 7; // Defined in the class or globally

class DataProcessor {
  static _escapeHTML(text) {
    if (typeof text !== 'string') return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  static processHeroStats(stats, minMatchCount = 100) {
    // Фильтруем и обрабатываем статистику героев

    // Рассчитываем общий средний винрейт (M_avg)
    const totalMatches = stats.reduce((sum, h) => sum + h.matchCount, 0);
    const totalWins = stats.reduce((sum, h) => sum + h.winCount, 0);
    const M_avg = totalMatches > 0 ? totalWins / totalMatches : 0.5; // Default to 0.5 if no matches
    const C = 100; // Вес для среднего значения (константа)

    const processed = stats
      .filter((h) => h.matchCount >= minMatchCount)
      .map((h) => {
        const winRate = h.matchCount > 0 ? h.winCount / h.matchCount : 0;
        // Формула Байесовского среднего: (WR * K + M_avg * C) / (K + C)
        // где WR - винрейт героя, K - количество матчей героя
        const bayesianAverage = (winRate * h.matchCount + M_avg * C) / (h.matchCount + C);
        return {
          heroId: h.heroId,
          matchCount: h.matchCount,
          winCount: h.winCount,
          winRate: winRate * 100, // по-прежнему отображаем фактический WR
          bayesianAverage: bayesianAverage, // используем для сортировки
        };
      })
      .sort((a, b) => b.bayesianAverage - a.bayesianAverage) // Сортируем по Байесовскому среднему
      .slice(0, 6);

    if (processed.length === 0) {
      console.log(`⚠️ No heroes found with enough matches (min: ${minMatchCount})`);
    } else {
      console.log(
        `📊 Found ${processed.length} heroes with sufficient matches (min: ${minMatchCount})`
      );
      console.log('📊 Top heroes:', JSON.stringify(processed, null, 2));
    }

    return processed;
  }

  static processAbilityBuild(
    levelStats, // Это старые данные, которые мы больше не будем напрямую использовать для этой логики
    abilityMap,
    heroName,
    rankUserChoiceText
    // heroAllAbilities - этот параметр тоже убираем, так как новая логика не зависит от него напрямую
  ) {
    // Старая логика processAbilityBuild пока остается для обратной совместимости или если новая не сработает
    // Но мы ее вызывать не будем для новой фичи
    // Фактически, этот метод может стать устаревшим или переписан для отображения данных,
    // если мы решим показывать и старую статистику тоже.
    // Пока что просто оставим его как есть, но не будем на него полагаться для нового скиллбилда.

    const recommendedBuildSequence = [];
    const detailedStatsByLevel = {};
    const skilledAbilityLevels = {};
    let ultimateTaken = false;

    // Группируем статистику по уровням
    if (levelStats && Array.isArray(levelStats)) {
      levelStats.forEach((stat) => {
        if (!detailedStatsByLevel[stat.level]) {
          detailedStatsByLevel[stat.level] = [];
        }
        detailedStatsByLevel[stat.level].push(stat);
      });
    }

    // Сортируем способности на каждом уровне по количеству матчей (популярности)
    for (const level in detailedStatsByLevel) {
      detailedStatsByLevel[level].sort((a, b) => b.matchCount - a.matchCount);
    }

    // Формируем рекомендуемый билд для уровней 1-9
    for (let level = 1; level < 10; level++) {
      let skillChosenForThisLevel = null;

      // Pass 1 & 2: Популярность и правила (без Байеса, как было до недавних изменений)
      if (detailedStatsByLevel[level] && detailedStatsByLevel[level].length > 0) {
        for (const stat of detailedStatsByLevel[level]) {
          const abilityInfo = abilityMap[stat.abilityId];
          if (
            !abilityInfo ||
            abilityInfo.abilityType === 'talent' ||
            abilityInfo.abilityType === 'aspect'
          )
            continue;

          if (abilityInfo.abilityType === 'ultimate') {
            if (level < 6 || ultimateTaken) continue;
          }

          const currentPointsInSkill = skilledAbilityLevels[stat.abilityId] || 0;
          if (currentPointsInSkill >= abilityInfo.maxLevel) continue;

          // Если прошли все проверки, выбираем эту способность
          skillChosenForThisLevel = stat.abilityId;
          break; // Переходим к следующему уровню
        }
      }

      // Pass 3: Fallback логика по слотам (Q, W, E, D, F)
      if (!skillChosenForThisLevel) {
        const preferredSlotOrder = [0, 1, 2, 3, 4, 5]; // Q, W, E, D, F, R (R будет отфильтрован если level < 6 или ulti взят)
        // Нам нужен список способностей самого героя для этой логики.
        // В текущей реализации abilityMap содержит ВСЕ способности, а не только этого героя.
        // Это ограничение старой логики, которое в новой будет решено.
        // Для сохранения работоспособности этого fallback, мы его пока оставим как есть,
        // но он может быть неточным, если у героя нет способностей в каких-то из этих слотов.

        for (const slotToTry of preferredSlotOrder) {
          let potentialAbilityId = null;
          let potentialAbilityInfo = null;

          // Ищем способность в abilityMap по этому слоту
          // Это ОЧЕНЬ неэффективно и не гарантирует, что это способность текущего героя.
          // Но это то, как работало раньше.
          for (const [id, abInfo] of Object.entries(abilityMap)) {
            // Условие, что это способность героя, здесь отсутствует, что является проблемой старой логики.
            if (abInfo.slot === slotToTry) {
              if (abInfo.abilityType === 'ultimate') {
                if (level >= 6 && !ultimateTaken) {
                  potentialAbilityId = id;
                  potentialAbilityInfo = abInfo;
                  break;
                }
              } else if (abInfo.abilityType === 'basic' || abInfo.abilityType === 'aspect') {
                potentialAbilityId = id;
                potentialAbilityInfo = abInfo;
                break;
              }
            }
          }

          if (potentialAbilityId && potentialAbilityInfo) {
            const currentPointsInSkill = skilledAbilityLevels[potentialAbilityId] || 0;
            if (currentPointsInSkill < potentialAbilityInfo.maxLevel) {
              skillChosenForThisLevel = potentialAbilityId;
              break; // Выбрали скилл, переходим к следующему уровню
            }
          }
        }
      }

      if (skillChosenForThisLevel) {
        recommendedBuildSequence.push(skillChosenForThisLevel);
        const points = (skilledAbilityLevels[skillChosenForThisLevel] || 0) + 1;
        skilledAbilityLevels[skillChosenForThisLevel] = points;
        if (abilityMap[skillChosenForThisLevel].abilityType === 'ultimate' && level >= 6) {
          ultimateTaken = true;
        }
      } else {
        recommendedBuildSequence.push(null); // Если ничего не выбрано, добавляем null
      }
    }

    // Форматирование сообщения (остается как в старой версии для примера)
    const messageParts = [];
    const heroNameHTML = DataProcessor._escapeHTML(heroName || 'выбранного героя');
    const rankTextHTML = DataProcessor._escapeHTML(rankUserChoiceText || 'Не указан');

    messageParts.push(`<b>📘 Скиллбилд для ${heroNameHTML}</b> (старая логика)`);
    messageParts.push(`<b>Ранг: ${rankTextHTML}</b>\n`);

    const levelColWidth = 4;
    const skillColWidth = 24;
    const wrColWidth = 5; // Для WR%

    const header = `LVL |${'Ability'.padEnd(skillColWidth)} |${'WR'.padStart(wrColWidth)} `;
    const separator = `${'-'.repeat(levelColWidth)}+${'-'.repeat(skillColWidth + 2)}+${'-'.repeat(wrColWidth + 1)}`;

    messageParts.push('<b>Рекомендованный билд (1-9):</b>');
    messageParts.push('`<pre>');
    messageParts.push(header);
    messageParts.push(separator);

    for (let i = 0; i < recommendedBuildSequence.length; i++) {
      const level = i + 1;
      const abilityId = recommendedBuildSequence[i];
      const abilityInfo = abilityId ? abilityMap[abilityId] : null;
      const abilityName = abilityInfo
        ? `${abilityInfo.displayName} (${abilityInfo.hotKey || 'N/A'})`
        : 'N/A';
      // Статистику WR для этого билда здесь показать сложно, так как это просто последовательность
      // Мы бы могли показать WR для этой способности НА ЭТОМ УРОВНЕ из detailedStatsByLevel, если есть
      let wrAtLevel = 'N/A';
      if (abilityId && detailedStatsByLevel[level]) {
        const statForThisSkill = detailedStatsByLevel[level].find((s) => s.abilityId === abilityId);
        if (statForThisSkill && statForThisSkill.matchCount > 0) {
          wrAtLevel = `${((statForThisSkill.winCount / statForThisSkill.matchCount) * 100).toFixed(1)}%`;
        }
      }
      messageParts.push(
        `${level.toString().padEnd(levelColWidth)}| ${abilityName.padEnd(skillColWidth)} |${wrAtLevel.padStart(wrColWidth)} `
      );
    }
    messageParts.push('</pre>`\n');

    // ... остальная часть форматирования сообщения может быть добавлена при необходимости ...

    return {
      message: messageParts.join('\n'),
      parse_mode: 'HTML',
    };
  }

  static processItemBuild(
    itemDataFromApi,
    itemMap,
    heroName = 'Выбранный герой',
    rankUserChoiceText,
    positionText
  ) {
    if (!itemDataFromApi || typeof itemDataFromApi !== 'object' || !itemMap) {
      console.log('⚠️ Missing required data for processing items (processItemBuild)');
      return {
        message: 'Не удалось получить данные о предметах (processItemBuild).',
        parse_mode: 'HTML',
      };
    }

    const { startingItems, midGameItems, lateGameItems } = itemDataFromApi;

    const MIN_MATCHES_PERCENT = 5;
    const MIN_ABSOLUTE_MATCHES = 10;
    const ITEMS_TO_SHOW = 6;

    const itemNameColWidth = 20;
    const wrColWidth = 5;
    const gamesColWidth = 7;

    const padString = (str, len, char = ' ') => {
      str = String(str);
      if (str.length > len) {
        if (len < 2) return str.substring(0, len);
        return str.substring(0, len - 2) + '..';
      } else {
        return str + char.repeat(len - str.length);
      }
    };

    const processItemCategory = (items, categoryName) => {
      const escapedCategoryName = DataProcessor._escapeHTML(categoryName);
      if (!Array.isArray(items) || items.length === 0) {
        return `\n<b>${escapedCategoryName}:</b>\n<pre>Нет данных</pre>`;
      }

      const aggregatedItemsMap = new Map();
      items.forEach((item) => {
        const itemNameFromMap = itemMap[item.itemId];
        if (!itemNameFromMap) {
          console.log(`⚠️ Unknown item ID in ${categoryName}: ${item.itemId}`);
          return;
        }
        const itemName = itemNameFromMap;
        if (aggregatedItemsMap.has(item.itemId)) {
          const existing = aggregatedItemsMap.get(item.itemId);
          existing.matchCount += item.matchCount || 0;
          existing.winCount += item.winCount || 0;
        } else {
          aggregatedItemsMap.set(item.itemId, {
            itemId: item.itemId,
            name: itemName,
            matchCount: item.matchCount || 0,
            winCount: item.winCount || 0,
          });
        }
      });

      const aggregatedItemsArray = Array.from(aggregatedItemsMap.values());
      const processed = aggregatedItemsArray
        .map((item) => ({
          ...item,
          winRate: item.matchCount > 0 ? (item.winCount / item.matchCount) * 100 : 0,
        }))
        .filter((item) => item.matchCount >= MIN_ABSOLUTE_MATCHES);

      if (processed.length === 0) {
        return `\n<b>${escapedCategoryName}:</b>\n<pre>Нет популярных предметов (${MIN_ABSOLUTE_MATCHES}+ игр)</pre>`;
      }

      processed.sort((a, b) => b.matchCount - a.matchCount);
      const topMatchCount = processed[0].matchCount;
      const filteredByRelativePopularity = processed.filter(
        (item) => (item.matchCount / topMatchCount) * 100 >= MIN_MATCHES_PERCENT
      );

      if (filteredByRelativePopularity.length === 0) {
        return `\n<b>${escapedCategoryName}:</b>\n<pre>Нет достаточно популярных предметов (>${MIN_MATCHES_PERCENT}% от топа)</pre>`;
      }

      const topItems = filteredByRelativePopularity.slice(0, ITEMS_TO_SHOW);

      let itemsString = '\n\n<pre>';
      itemsString += `${padString('Item', itemNameColWidth)}|${padString('WR', wrColWidth)}|${padString('Matches', gamesColWidth)}\n`;
      itemsString += `${'-'.repeat(itemNameColWidth)}|${'-'.repeat(wrColWidth)}|${'-'.repeat(gamesColWidth)}\n`;

      topItems.forEach((item) => {
        const escapedName = DataProcessor._escapeHTML(item.name);
        const namePadded = padString(escapedName, itemNameColWidth);
        const wrPadded = padString(
          DataProcessor._escapeHTML(item.winRate.toFixed(1) + '%'),
          wrColWidth
        );
        const gamesPadded = padString(
          DataProcessor._escapeHTML(String(item.matchCount)),
          gamesColWidth
        );
        itemsString += `${namePadded}|${wrPadded}|${gamesPadded}\n`;
      });
      itemsString += '</pre>\n';

      return `\n<b>${escapedCategoryName}:</b>${itemsString}`;
    };

    try {
      const messageParts = [`<b>🎒 Итембилд для ${DataProcessor._escapeHTML(heroName)}</b>`];

      if (rankUserChoiceText && positionText) {
        messageParts.push(
          `<b>${DataProcessor._escapeHTML('Ранг: ' + rankUserChoiceText + ', Роль: ' + positionText)}</b>\n`
        );
      }

      messageParts.push(processItemCategory(startingItems, 'Стартовые предметы'));
      messageParts.push(processItemCategory(midGameItems, 'Мид-гейм предметы'));
      messageParts.push(processItemCategory(lateGameItems, 'Лейт-гейм предметы'));

      const finalMessage = messageParts.join('\n');

      return { message: finalMessage, parse_mode: 'HTML' };
    } catch (error) {
      console.error('❌ Error processing items:', error);
      return {
        message: 'Не удалось обработать данные о предметах для этого героя.',
        parse_mode: 'HTML',
      };
    }
  }

  constructor() {
    this.MAX_LEVEL_TO_CONSIDER = 12; // Max hero level to record skill choices for data aggregation
    this.TARGET_BUILD_LEVEL = 9; // Display the most common build up to this level (e.g., 1-9)
    // User mentioned levels 1-7 before, but 9 is common for early game summary.
    // This can be adjusted as needed.
  }

  static processMatchDataForSkillBuild(
    matches, // Array of full match detail objects
    targetHeroId, // The ID of the hero we're building skills for
    abilityMap, // Global ability map
    positionKey // NEW: The MatchPlayerPositionType string (e.g., "POSITION_1")
    // heroName and rankUserChoiceText removed as they are not directly used for skill point processing
  ) {
    console.log(
      `[DataProcessor DEBUG] processMatchDataForSkillBuild called for HeroID: ${targetHeroId}, Position: ${positionKey}. Processing ${matches ? matches.length : 0} matches.`
    );
    if (!matches || matches.length === 0) {
      console.warn('[DataProcessor WARN] No matches provided to processMatchDataForSkillBuild.');
      return [];
    }

    const skillPointEventsByMatch = [];
    const TARGET_BUILD_LEVEL = 12;

    matches.forEach((match, matchIndex) => {
      if (!match || !match.players || !Array.isArray(match.players)) {
        console.warn(
          `[DataProcessor WARN] Match ${matchIndex} (ID: ${match.id || 'N/A'}) has no player data or is malformed. Skipping.`
        );
        return;
      }

      const player = match.players.find(
        (p) => p.heroId === targetHeroId && p.position === positionKey
      );

      if (!player) {
        console.log(
          `[DataProcessor TRACE] Match ${match.id}: Target hero ${targetHeroId} not found playing in position ${positionKey}. Checking all players for this hero...`
        );
        const heroInOtherPosition = match.players.find((p) => p.heroId === targetHeroId);
        if (heroInOtherPosition) {
          console.log(
            `[DataProcessor TRACE] ...Hero ${targetHeroId} was found in position ${heroInOtherPosition.position} in match ${match.id}.`
          );
        } else {
          console.log(
            `[DataProcessor TRACE] ...Hero ${targetHeroId} was not found in any position in match ${match.id}.`
          );
        }
        return;
      }

      if (!player.abilities || !Array.isArray(player.abilities) || player.abilities.length === 0) {
        console.warn(
          `[DataProcessor WARN] Player ${player.steamAccountId || 'N/A'} (Hero ${player.heroId}) in Match ${match.id} has no ability upgrade data. Skipping player.`
        );
        return;
      }

      const upgrades = player.abilities
        .map((ab) => ({
          abilityId: ab.abilityId,
          time: ab.time,
          level: ab.level,
        }))
        .sort((a, b) => a.time - b.time);

      const matchSkillPoints = [];
      let heroLevelSkillPointSpentAt = 0;

      upgrades.forEach((upgrade) => {
        const abilityInfo = abilityMap[upgrade.abilityId];

        if (
          !abilityInfo ||
          ABILITIES_TO_FILTER_OUT.includes(upgrade.abilityId) ||
          (upgrade.abilityId >= 6000 &&
            upgrade.abilityId <= 8000 &&
            LOW_ID_TALENTS_TO_FILTER.includes(upgrade.abilityId)) ||
          abilityInfo.isTalent ||
          abilityInfo.abilityName === 'generic_hidden' ||
          (abilityInfo.stat && abilityInfo.stat.isTalent)
        ) {
          return;
        }

        heroLevelSkillPointSpentAt++;

        if (abilityInfo.isUltimate) {
          if (heroLevelSkillPointSpentAt < 6) {
            console.warn(
              `[DataProcessor TRACE WARN] Player ${player.steamAccountId}, Hero ${player.heroId}, Match ${match.id}: Attempted to skill Ultimate ID ${upgrade.abilityId} at Hero Level ${heroLevelSkillPointSpentAt} (Time: ${upgrade.time}). Skipping. (Corrected Static Logic)`
            );
            heroLevelSkillPointSpentAt--;
            return;
          }
        }

        if (heroLevelSkillPointSpentAt <= TARGET_BUILD_LEVEL) {
          matchSkillPoints.push({
            heroLevel: heroLevelSkillPointSpentAt,
            abilityId: upgrade.abilityId,
            time: upgrade.time,
          });
        }
      });

      if (matchSkillPoints.length > 0) {
        skillPointEventsByMatch.push({
          matchId: match.id,
          heroId: player.heroId,
          steamAccountId: player.steamAccountId,
          skillPoints: matchSkillPoints,
        });
      }
    });
    return skillPointEventsByMatch;
  }

  static processGameConstants(constants) {
    const heroMap = Object.fromEntries(constants.heroes.map((h) => [h.id, h.displayName]));
    const itemMap = Object.fromEntries(constants.items.map((i) => [i.id, i.displayName]));
    const abilityMap = {};

    if (constants.heroes && Array.isArray(constants.heroes)) {
      constants.heroes.forEach((hero) => {
        if (hero.abilities && Array.isArray(hero.abilities)) {
          hero.abilities.forEach((heroAbility) => {
            const abilityId = heroAbility.abilityId;
            const abilityDetails = heroAbility.ability;
            const displayName =
              abilityDetails?.language?.displayName ||
              abilityDetails?.name ||
              `Ability ${abilityId}`;

            if (!abilityId || abilityMap[abilityId]) return;

            let hotKey = 'N/A';
            const abilityStat = abilityDetails?.stat;
            const abilitySlot = heroAbility.slot;
            const isTalent = abilityDetails?.isTalent || false;
            const isUltimate = abilityStat?.isUltimate || false;

            // <<< START DEBUG LOGGING FOR ELDER TITAN ABILITIES >>>
            // if (hero.id === 103 && [5589, 5590, 5591, 5594, 5592].includes(abilityId)) { // Added 5592 for Natural Order check
            //   console.log(`[DEBUG HOTKEY GEN - Hero Ability] HeroID: ${hero.id}, AbilityID: ${abilityId}, Name: ${displayName}`);
            //   console.log(`  > API Slot: ${abilitySlot}, API MaxLevel: ${heroAbility.maxLevel}`);
            //   console.log(`  > Details: ${JSON.stringify(abilityDetails)}`);
            //   console.log(`  > Stat: ${JSON.stringify(abilityStat)}`);
            // }
            // <<< END DEBUG LOGGING >>>

            let maxLevel = heroAbility.maxLevel;
            if (typeof maxLevel !== 'number' || maxLevel <= 0) {
              maxLevel = abilityStat?.maxLevel;
            }
            if (typeof maxLevel !== 'number' || maxLevel <= 0) {
              if (isUltimate) maxLevel = 3;
              else if (isTalent) maxLevel = 1;
              else maxLevel = 4;
            }

            let abilityType = 'basic';
            if (isTalent) {
              abilityType = 'talent';
            } else if (isUltimate) {
              abilityType = 'ultimate';
            } else if (
              (typeof heroAbility.type === 'string' &&
                heroAbility.type.toLowerCase().includes('facet')) ||
              displayName?.toLowerCase().includes('aspect') ||
              displayName?.toLowerCase().includes('facet') ||
              displayName?.toLowerCase().includes('вариант')
            ) {
              abilityType = 'aspect';
              if (
                maxLevel > 1 &&
                (displayName?.toLowerCase().includes('aspect') ||
                  displayName?.toLowerCase().includes('facet'))
              ) {
                maxLevel = 1;
              }
            }

            if (isTalent) {
              hotKey = 'Talent';
            } else if (isUltimate) {
              hotKey = 'R';
              if (abilityStat?.hotKeyOverride) {
                hotKey = abilityStat.hotKeyOverride;
              }
            } else if (abilityType === 'basic' || abilityType === 'aspect') {
              if (abilityStat?.hotKeyOverride) {
                hotKey = abilityStat.hotKeyOverride;
              } else {
                switch (abilitySlot) {
                  case 0:
                    hotKey = 'Q';
                    break;
                  case 1:
                    hotKey = 'W';
                    break;
                  case 2:
                    hotKey = 'E';
                    break;
                  case 3:
                    hotKey = 'D';
                    break;
                  case 4:
                    hotKey = 'F';
                    break;
                  default:
                    hotKey = 'N/A';
                    break;
                }
              }
            }

            // --- START HERO-SPECIFIC HOTKEY OVERRIDES ---
            if (hero.id === 103) {
              // Elder Titan
              if (abilityId === 5589) {
                hotKey = 'Q';
              } // Echo Stomp
              else if (abilityId === 5591) {
                hotKey = 'W';
              } // Astral Spirit
              else if (abilityId === 5592) {
                hotKey = 'E';
              } // Natural Order (Passive, but for completeness if it appears)
              else if (abilityId === 5594) {
                hotKey = 'R';
              } // Earth Splitter
            }
            // --- END HERO-SPECIFIC HOTKEY OVERRIDES ---

            // <<< START DEBUG LOGGING FOR ELDER TITAN ABILITIES (POST-LOGIC) >>>
            // if (hero.id === 103 && [5589, 5590, 5591, 5594, 5592].includes(abilityId)) {
            //   console.log(`  > Calculated Hotkey: ${hotKey}, Calculated Type: ${abilityType}, IsUltimate: ${isUltimate}, IsTalent: ${isTalent}, Final Slot: ${abilitySlot}`);
            // }
            // <<< END DEBUG LOGGING >>>

            abilityMap[abilityId] = {
              displayName: displayName,
              hotKey: hotKey,
              isUltimate: isUltimate,
              isTalent: isTalent,
              slot: abilitySlot,
              maxLevel: maxLevel,
              abilityType: abilityType,
            };
          });
        }
      });
    }

    if (constants.abilities && Array.isArray(constants.abilities)) {
      constants.abilities.forEach((globalAbility) => {
        const abilityId = globalAbility.id;
        if (!abilityMap[abilityId]) {
          let displayName =
            globalAbility.language?.displayName || globalAbility.name || `Ability ${abilityId}`;
          const stat = globalAbility.stat;
          const isTalent = globalAbility.isTalent || false;
          const isUltimate = stat?.isUltimate || false;

          // <<< START DEBUG LOGGING FOR ELDER TITAN ABILITIES (GLOBAL LIST) >>>
          // if ([5589, 5590, 5591, 5594, 5592].includes(abilityId)) {
          //   console.log(`[DEBUG HOTKEY GEN - Global Ability] AbilityID: ${abilityId}, Name: ${displayName}`);
          //   console.log(`  > Global Details: ${JSON.stringify(globalAbility)}`);
          //   console.log(`  > Global Stat: ${JSON.stringify(stat)}`);
          // }
          // <<< END DEBUG LOGGING >>>

          let maxLevel = stat?.maxLevel;
          if (typeof maxLevel !== 'number' || maxLevel <= 0) {
            if (isUltimate) maxLevel = 3;
            else if (isTalent) maxLevel = 1;
            else maxLevel = 4;
          }

          let hotKey = 'N/A';
          let abilityType = 'basic';

          if (isTalent) {
            abilityType = 'talent';
            hotKey = 'Talent';
          } else if (isUltimate) {
            abilityType = 'ultimate';
            hotKey = 'R';
            if (stat?.hotKeyOverride) hotKey = stat.hotKeyOverride;
          } else if (
            displayName?.toLowerCase().includes('aspect') ||
            displayName?.toLowerCase().includes('facet') ||
            displayName?.toLowerCase().includes('вариант')
          ) {
            abilityType = 'aspect';
            if (
              maxLevel > 1 &&
              (displayName?.toLowerCase().includes('aspect') ||
                displayName?.toLowerCase().includes('facet'))
            ) {
              maxLevel = 1;
            }
            if (stat?.hotKeyOverride) hotKey = stat.hotKeyOverride;
          } else {
            if (stat?.hotKeyOverride) hotKey = stat.hotKeyOverride;
          }

          if (abilityId === 5087) {
            abilityType = 'aspect';
            maxLevel = 1;
            hotKey = 'W';
            displayName = displayName || 'Bone Guard';
          } else if (abilityId === 1282) {
            abilityType = 'aspect';
            maxLevel = 1;
            hotKey = 'W';
            displayName = displayName || 'Spectral Blade';
          }

          // --- START GLOBAL HERO-SPECIFIC HOTKEY OVERRIDES (APPLIES IF PROCESSED GLOBALLY) ---
          // Note: hero.id is not available here, so we rely only on abilityId for global list overrides.
          // This is less ideal but can catch abilities missed in hero-specific processing if their IDs are unique enough.
          if (abilityId === 5589) {
            hotKey = 'Q';
          } // Elder Titan - Echo Stomp
          else if (abilityId === 5591) {
            hotKey = 'W';
          } // Elder Titan - Astral Spirit
          else if (abilityId === 5592) {
            hotKey = 'E';
          } // Elder Titan - Natural Order
          else if (abilityId === 5594) {
            hotKey = 'R';
          } // Elder Titan - Earth Splitter
          // --- END GLOBAL HERO-SPECIFIC HOTKEY OVERRIDES ---

          // <<< START DEBUG LOGGING FOR ELDER TITAN ABILITIES (GLOBAL LIST POST-LOGIC) >>>
          // if ([5589, 5590, 5591, 5594, 5592].includes(abilityId)) {
          //    console.log(`  > Global Calculated Hotkey: ${hotKey}, Global Calculated Type: ${abilityType}, Global IsUltimate: ${isUltimate}, Global IsTalent: ${isTalent}`);
          // }
          // <<< END DEBUG LOGGING >>>

          abilityMap[abilityId] = {
            displayName: displayName,
            hotKey: hotKey,
            isUltimate: isUltimate,
            isTalent: isTalent,
            slot: null,
            maxLevel: maxLevel,
            abilityType: abilityType,
          };
        }
      });
    }

    return { HERO_MAP: heroMap, ITEM_MAP: itemMap, ABILITY_MAP: abilityMap };
  }
}

module.exports = DataProcessor;
