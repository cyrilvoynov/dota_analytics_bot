const axios = require('axios');
const { GraphQLClient } = require('graphql-request');
const { STRATZ_API_URL } = require('../config/config.js');
const DataProcessor = require('../utils/dataProcessor.js');
const {
  KEY_TO_RANK_BRACKET_ARRAY,
  KEY_TO_RANK_BRACKET_BASIC_ENUM_STRING,
  // KEY_TO_RANK_ID_INT, // Commented out as reported unused by ESLint in this file
} = require('../constants/gameConstants.js');

const DEFAULT_PATCH_ID = 179;
const DEFAULT_MATCHES_TO_ANALYZE = 30;

class StratzService {
  constructor(apiToken) {
    this.apiToken = apiToken;
    console.log(
      `[StratzService Constructor] Received apiToken: ${apiToken ? apiToken.substring(0, 5) + '...' + apiToken.substring(apiToken.length - 5) : 'TOKEN NOT RECEIVED'}`
    );
    this.STRATZ_HEADERS = {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
      'User-Agent': 'STRATZ_API',
    };

    console.log('[StratzService Constructor] STRATZ_API_URL:', STRATZ_API_URL); // DEBUG LOG
    this.graphqlClient = new GraphQLClient(STRATZ_API_URL, {
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
      },
    });
    console.log(
      '[StratzService Constructor] this.graphqlClient initialized:',
      typeof this.graphqlClient,
      this.graphqlClient !== null && this.graphqlClient !== undefined
    ); // DEBUG LOG

    this.PATCH_ID = null;
    this.currentPatchReleaseDateTime = null;
    this.ITEM_MAP = {};
    this.HERO_MAP = {};
    this.ABILITY_MAP = {};
    this.isInitializedFlag = false;
    this.initializationPromise = this.initialize();

    // Bind methods to ensure correct 'this' context
    // this.fetchProSkillBuildMatches = this.fetchProSkillBuildMatches.bind(this); // DEPRECATED
    this.fetchMatchDetails = this.fetchMatchDetails.bind(this);
  }

  async initialize() {
    console.log('🚀 Initializing StratzService...');
    try {
      // Fetch patch data and raw constants data in parallel
      const [, rawConstants] = await Promise.all([
        this.fetchPatchData(), // Fetches and sets this.PATCH_ID
        this.fetchRawConstants(), // Fetches raw constants from API
      ]);

      if (!rawConstants) {
        console.error('❌ Critical: Failed to fetch raw constants during initialization.');
        throw new Error('Raw constants data is undefined after fetching.');
      }

      // Process constants and populate maps
      console.log('🔄 Processing game constants...');
      const {
        HERO_MAP: hMap,
        ABILITY_MAP: aMap,
        ITEM_MAP: iMap,
      } = DataProcessor.processGameConstants(rawConstants);
      this.HERO_MAP = hMap;
      this.ABILITY_MAP = aMap;
      this.ITEM_MAP = iMap;
      console.log('✅ Game constants processed and maps populated.');

      console.log('✅ StratzService initialized successfully.');
      console.log(`   - Patch ID: ${this.PATCH_ID}`);
      console.log(`   - Heroes loaded: ${Object.keys(this.HERO_MAP).length}`);
      console.log(`   - Abilities loaded: ${Object.keys(this.ABILITY_MAP).length}`);
      console.log(`   - Items loaded: ${Object.keys(this.ITEM_MAP).length}`);
      if (
        this.PATCH_ID === null ||
        Object.keys(this.HERO_MAP).length === 0 ||
        Object.keys(this.ABILITY_MAP).length === 0 ||
        Object.keys(this.ITEM_MAP).length === 0
      ) {
        console.warn(
          '⚠️ StratzService initialization completed but some data might be missing or PATCH_ID is null.'
        );
      }
      this.isInitializedFlag = true;
    } catch (error) {
      console.error('❌❌❌ StratzService failed to initialize:', error);
      this.isInitializedFlag = false;
      // Rethrow or handle critical failure, app might not be usable
      throw error;
    }
  }

  isInitialized() {
    return this.isInitializedFlag;
  }

  async fetchRawConstants() {
    console.log('🔄 Fetching raw game constants from Stratz API...');
    try {
      const res = await axios.post(
        STRATZ_API_URL,
        {
          query: `{
          constants {
            heroes { 
              id 
              displayName 
              abilities { # Attempting to fetch HeroAbilityType array here
                abilityId
                slot
                ability { # This is AbilityType
                  name
                  language { displayName }
                  stat {
                    hotKeyOverride
                    isUltimate
                  }
                  isTalent
                }
              }
            }
            abilities { # Global abilities list for fallback names
              id 
              name 
              language { displayName }
              stat {
                hotKeyOverride
                isUltimate
              }
              isTalent
            }
            items { id displayName }
          }
        }`,
        },
        { headers: this.STRATZ_HEADERS }
      );

      // Check for GraphQL errors first
      if (res.data && res.data.errors) {
        console.error(
          '❌ GraphQL errors in fetchRawConstants:',
          JSON.stringify(res.data.errors, null, 2)
        );
        throw new Error('GraphQL query failed in fetchRawConstants with specific errors.');
      }

      // Then check if data and data.constants exist
      if (res.data && res.data.data && res.data.data.constants) {
        console.log('✅ Successfully fetched raw game constants data structure.');
        return res.data.data.constants;
      } else {
        console.error(
          '❌ No data.constants found in fetchRawConstants response. Full response data:',
          JSON.stringify(res.data, null, 2)
        );
        throw new Error(
          'No data.constants structure returned from Stratz API in fetchRawConstants.'
        );
      }
    } catch (error) {
      console.error('❌ Error in StratzService.fetchRawConstants catch block:', error.message);
      throw error;
    }
  }

  async fetchHeroStats(rankApiKey, positionIds) {
    await this.initializationPromise;

    const apiBracketIds = KEY_TO_RANK_BRACKET_ARRAY[rankApiKey];
    if (!apiBracketIds) {
      console.error(
        `❌ Invalid rankApiKey or no mapping found in KEY_TO_RANK_BRACKET_ARRAY for: ${rankApiKey}`
      );
      return [];
    }

    console.log(
      `🔄 Fetching hero stats for bracket(s): ${JSON.stringify(apiBracketIds)}, position(s): ${JSON.stringify(positionIds)}, gameMode: ALL_PICK_RANKED`
    );
    try {
      const query = `
        query($bracketIds: [RankBracket!], $positionIds: [MatchPlayerPositionType!], $gameModeIds: [GameModeEnumType!]) {
          heroStats {
            winDay(
              take: 1,
              bracketIds: $bracketIds,
              positionIds: $positionIds,
              gameModeIds: $gameModeIds
            ) {
              heroId
              matchCount
              winCount
              day
            }
          }
        }`;

      const variables = {
        bracketIds: apiBracketIds,
        positionIds: positionIds,
        gameModeIds: ['ALL_PICK_RANKED'],
      };

      const res = await axios.post(
        STRATZ_API_URL,
        { query, variables },
        { headers: this.STRATZ_HEADERS }
      );

      if (res.data.errors) {
        console.error('❌ GraphQL errors:', JSON.stringify(res.data.errors, null, 2));
        return [];
      }

      const stats = res.data?.data?.heroStats?.winDay || [];

      // Добавляем отладочный вывод
      console.log('🔍 Raw API response (winDay):', JSON.stringify(stats, null, 2)); // Clarified log

      // Группируем статистику по героям и суммируем данные
      const heroStats = new Map();
      stats.forEach((stat) => {
        if (!heroStats.has(stat.heroId)) {
          heroStats.set(stat.heroId, {
            heroId: stat.heroId,
            matchCount: 0,
            winCount: 0,
            day: stat.day, // Keep day for potential future use or logging, but it's aggregated
          });
        }
        const current = heroStats.get(stat.heroId);
        current.matchCount += stat.matchCount;
        current.winCount += stat.winCount;
        // Обновляем день только если он новее - это может не иметь смысла после агрегации
        // Если Stratz возвращает несколько записей на героя с разными днями в пределах своего окна,
        // то сохранение "самого нового дня" может быть полезно. Если он уже агрегирует по герою, то `day` может быть одинаковым или отсутствовать.
        // Для простой суммы matchCount/winCount это не критично.
        if (stat.day > current.day) {
          // Consider if this logic is still needed
          current.day = stat.day;
        }
      });

      const processedStats = Array.from(heroStats.values())
        .filter((stat) => stat.matchCount >= 50)
        .map((h) => {
          const winRate = h.winCount != null ? (h.winCount / h.matchCount) * 100 : null;
          console.log(
            `Processing hero ${h.heroId}: matches=${h.matchCount}, wins=${h.winCount}, winRate=${winRate}`
          );

          return {
            heroId: h.heroId,
            matchCount: h.matchCount,
            winCount: h.winCount,
            winRate: winRate,
            day: h.day,
          };
        })
        .sort((a, b) => {
          if (a.winRate === null && b.winRate === null) return b.matchCount - a.matchCount;
          if (a.winRate === null) return 1;
          if (b.winRate === null) return -1;
          return b.winRate - a.winRate;
        });

      console.log(`📊 Found ${processedStats.length} heroes for bracket ${rankApiKey}`);
      console.log('📊 Hero stats response:', JSON.stringify(processedStats, null, 2));

      return processedStats;
    } catch (error) {
      console.error('❌ Error fetching hero stats:', error.message);
      return [];
    }
  }

  async fetchItemBuild(heroId, rankApiKey, positionIds) {
    await this.initializationPromise;

    const apiBracketBasicEnum = KEY_TO_RANK_BRACKET_BASIC_ENUM_STRING[rankApiKey];
    if (!apiBracketBasicEnum) {
      console.error(
        `❌ Invalid rankApiKey or no mapping found in KEY_TO_RANK_BRACKET_BASIC_ENUM_STRING for: ${rankApiKey}`
      );
      return null;
    }

    console.log(
      `🔄 Fetching item build for hero: ${heroId}, bracket(s) basic enum: ${apiBracketBasicEnum}, position(s): ${JSON.stringify(positionIds)}`
    );

    const query = `
      query ($heroId: Short!, $bracketBasicIds: [RankBracketBasicEnum!], $positionIds: [MatchPlayerPositionType!]) {
        heroStats {
          itemStartingPurchase(
            heroId: $heroId
            bracketBasicIds: $bracketBasicIds
            positionIds: $positionIds
            # take: 10 // Argument 'take' is not supported
          ) {
            itemId
            matchCount
            winCount
          }
          itemMidGamePurchase: itemFullPurchase(
            heroId: $heroId
            minTime: 15 # In MINUTES, as per API docs
            maxTime: 35 # In MINUTES, as per API docs
            bracketBasicIds: $bracketBasicIds
            positionIds: $positionIds
            matchLimit: 0 # Re-adding matchLimit: 0
            # take: 15 // Argument 'take' is not supported
          ) {
            itemId
            matchCount
            winCount
            time 
          }
          itemLateGamePurchase: itemFullPurchase(
            heroId: $heroId
            minTime: 35 # In MINUTES, as per API docs
            maxTime: 75 # In MINUTES, as per API docs (max allowed is 75)
            bracketBasicIds: $bracketBasicIds
            positionIds: $positionIds
            matchLimit: 0 # Re-adding matchLimit: 0
            # take: 15 // Argument 'take' is not supported
          ) {
            itemId
            matchCount
            winCount
            time 
          }
        }
      }
    `;

    const variables = {
      heroId: parseInt(heroId, 10),
      bracketBasicIds: [apiBracketBasicEnum],
      positionIds: positionIds,
    };

    try {
      const res = await axios.post(
        STRATZ_API_URL,
        { query, variables },
        { headers: this.STRATZ_HEADERS }
      );

      if (res.data.errors) {
        console.error(
          '❌ GraphQL errors in fetchItemBuild:',
          JSON.stringify(res.data.errors, null, 2)
        );
        return null;
      }

      const startingItems = res.data?.data?.heroStats?.itemStartingPurchase || [];
      const midGameItems = res.data?.data?.heroStats?.itemMidGamePurchase || [];
      const lateGameItems = res.data?.data?.heroStats?.itemLateGamePurchase || [];

      console.log('📥 Raw API Response (starting items):', JSON.stringify(startingItems));
      console.log('📥 Raw API Response (mid game items):', JSON.stringify(midGameItems));
      console.log('📥 Raw API Response (late game items):', JSON.stringify(lateGameItems));

      const validateItem = (item) => {
        if (!item || typeof item !== 'object') {
          console.warn('⚠️ Invalid item object:', item);
          return false;
        }
        if (typeof item.itemId !== 'number') {
          console.warn('⚠️ Missing or invalid itemId:', item);
          return false;
        }
        // matchCount might not be present or zero for some items, especially starting ones if only purchase matters
        // We will ensure it's a number in the map stage
        // if (typeof item.matchCount !== 'number') {
        //   console.warn('⚠️ Missing or invalid matchCount for item:', item.itemId, item);
        //   return false;
        // }
        return true;
      };

      const filteredStartingItems = startingItems
        .filter((item) => validateItem(item) && !item.wasGiven)
        .map(({ itemId, matchCount, winCount, instance }) => ({
          itemId,
          matchCount: matchCount || 0,
          winCount: winCount || 0,
          time: 0,
          instance,
        }));

      const filteredMidGameItems = midGameItems
        .filter(validateItem)
        .map(({ itemId, matchCount, winCount, time, instance }) => ({
          itemId,
          matchCount: matchCount || 0,
          winCount: winCount || 0,
          time: Math.round(time || 0),
          instance,
        }));

      const filteredLateGameItems = lateGameItems
        .filter(validateItem)
        .map(({ itemId, matchCount, winCount, time, instance }) => ({
          itemId,
          matchCount: matchCount || 0,
          winCount: winCount || 0,
          time: Math.round(time || 0),
          instance,
        }));

      console.log(
        '📦 Processed Starting Items (IDs):',
        JSON.stringify(
          filteredStartingItems.map((i) => i.itemId),
          null,
          2
        )
      );
      console.log(
        '📦 Processed Mid Game Items (IDs):',
        JSON.stringify(
          filteredMidGameItems.map((i) => i.itemId),
          null,
          2
        )
      );
      console.log(
        '📦 Processed Late Game Items (IDs):',
        JSON.stringify(
          filteredLateGameItems.map((i) => i.itemId),
          null,
          2
        )
      );

      if (
        filteredStartingItems.length === 0 &&
        filteredMidGameItems.length === 0 &&
        filteredLateGameItems.length === 0
      ) {
        console.warn(`⚠️ No valid item data found for hero ${heroId} with current filters.`);
      }

      return {
        startingItems: filteredStartingItems,
        midGameItems: filteredMidGameItems,
        lateGameItems: filteredLateGameItems,
      };
    } catch (error) {
      console.error(`❌ Error in fetchItemBuild for hero ${heroId}:`, error.message, error.stack);
      return null; // Return null or an empty structure on error
    }
  }

  async fetchHeroAbilityBuildData(heroId, rankApiKey, positionIds) {
    await this.initializationPromise;

    const apiBracketBasicEnum = KEY_TO_RANK_BRACKET_BASIC_ENUM_STRING[rankApiKey];
    if (!apiBracketBasicEnum) {
      console.error(
        `❌ Invalid rankApiKey or no mapping found in KEY_TO_RANK_BRACKET_BASIC_ENUM_STRING for: ${rankApiKey}`
      );
      return null;
    }

    console.log(
      `🔄 Fetching ability build for hero: ${heroId}, bracket(s) basic enum: ${apiBracketBasicEnum}, position(s): ${JSON.stringify(positionIds)}`
    );

    const query = `
      query GetHeroAbilityBuild(
        $heroId: Short!,
        $matchGroupBracketBasicIds: [RankBracketBasicEnum!],
        $positionIds: [MatchPlayerPositionType!]
      ) {
        heroStats {
          ability: abilityMinLevel(
            heroId: $heroId,
            bracketBasicIds: $matchGroupBracketBasicIds,
            positionIds: $positionIds
          ) {
            abilityId
            level
            matchCount
            winCount
          }
        }
      }
    `;

    const variables = {
      heroId: parseInt(heroId, 10),
      matchGroupBracketBasicIds: [apiBracketBasicEnum],
      positionIds: positionIds,
    };

    console.log(
      `[StratzService DEBUG] fetchHeroAbilityBuildData: Using PATCH_ID (for reference, not direct arg): ${this.PATCH_ID}`
    );
    console.log(
      `[StratzService DEBUG] fetchHeroAbilityBuildData variables: ${JSON.stringify(variables, null, 2)}`
    );

    try {
      const response = await this.graphQLRequest(query, variables);
      console.log(
        `[StratzService DEBUG] Raw response from fetchHeroAbilityBuildData for hero ${heroId}: ${JSON.stringify(response, null, 2)}`
      );

      // Validate structure
      if (response && response.heroStats && response.heroStats.ability) {
        // Return the relevant part of the data
        // The old logic was expecting response.data.heroStats.levelUp
        // The new query structure for abilityMinLevel is response.heroStats.ability
        // To maintain compatibility with how DataProcessor might expect it,
        // we might need to adjust this, or adjust DataProcessor.
        // For now, let's return the direct data from the new query structure.
        // The new query is heroStats { ability { ... } }
        // DataProcessor was expecting levelUp which was an array.
        // The new 'ability' field is also an array of stats.
        return {
          level: response.heroStats.ability, // This makes it look like the old levelUp
          // We should verify if DataProcessor needs more fields from the old structure
        };
      } else {
        console.warn(
          `[StratzService WARN] fetchHeroAbilityBuildData for hero ${heroId} returned unexpected structure or no data.`
        );
        return null;
      }
    } catch (error) {
      console.error(`❌ Error fetching hero ability build data for hero ${heroId}:`, error);
      throw error;
    }
  }

  // DEPRECATED: This method proved unreliable for fetching pro match skill builds
  // for specific past patches due to API limitations and errors.
  // Repurposing this to fetch RECENT pro matches on the CURRENT patch.
  async fetchRecentProMatches(
    heroIds,
    positionKey,
    solicitadoTake = DEFAULT_MATCHES_TO_ANALYZE,
    solicitadoSkip = 0
  ) {
    await this.initializationPromise;
    console.log(
      `[fetchRecentProMatches] Called with heroIds: ${JSON.stringify(heroIds)}, positionKey: ${positionKey}, take: ${solicitadoTake}, skip: ${solicitadoSkip}`
    ); // DEBUG LOG

    if (!this.isInitialized()) {
      console.error(
        '❌ [fetchRecentProMatches] StratzService not initialized. Call initialize() first.'
      );
      return []; // Return empty or throw error
    }

    if (!heroIds || heroIds.length === 0) {
      console.warn('[fetchRecentProMatches] No hero IDs provided.');
      return [];
    }

    // Ensure patchId is available
    if (!this.PATCH_ID) {
      console.warn(
        '[fetchRecentProMatches] Current patch ID is not set. Fetching patch data first.'
      );
      await this.fetchPatchData();
      if (!this.PATCH_ID) {
        console.error('❌ [fetchRecentProMatches] Failed to fetch patch ID. Cannot proceed.');
        return [];
      }
      console.log(`[fetchRecentProMatches] Patch ID set to: ${this.PATCH_ID}`);
    }

    const leagueQueryStartDateTime = this.currentPatchReleaseDateTime - 7 * 24 * 60 * 60; // 7 days before patch release

    console.log(
      `[fetchRecentProMatches] Step 0: Using leagueQueryStartDateTime: ${new Date(
        leagueQueryStartDateTime * 1000
      ).toISOString()} (Timestamp: ${leagueQueryStartDateTime}) for fetching league IDs.`
    );
    console.log(`[fetchRecentProMatches] Target Patch ID for match filtering: ${this.PATCH_ID}`);

    try {
      // Step 1: Fetch recent league IDs
      console.log('[fetchRecentProMatches] Step 1: Fetching recent league IDs...');
      const leagueIdQuery = `
        query RecentLeagues($startDateTime: Long!) {
          leagues(request: { startDateTime: $startDateTime, take: 25, tiers: [PROFESSIONAL, PREMIUM] }) {
            id
            displayName
            startDateTime
            endDateTime
          }
        }
      `;
      const leagueIdVariables = { startDateTime: leagueQueryStartDateTime };
      // Assuming graphqlClient.request can take a string query directly
      const leagueIdData = await this.graphqlClient.request(leagueIdQuery, leagueIdVariables);

      const leagueIds = leagueIdData?.leagues?.map((l) => l.id).filter((id) => id != null);

      if (!leagueIds || leagueIds.length === 0) {
        console.warn(
          `[fetchRecentProMatches] No recent PROFESSIONAL or PREMIUM league IDs found starting from ${new Date(
            leagueQueryStartDateTime * 1000
          ).toISOString()}. Cannot fetch pro matches.`
        );
        return [];
      }
      console.log(
        `[fetchRecentProMatches] Found ${leagueIds.length} league IDs: ${JSON.stringify(leagueIds)}`
      );

      // Step 2: Fetch pro player matches for the given hero and leagues, now with positionKey
      console.log(
        `[fetchRecentProMatches] Step 2: Fetching pro player matches for hero(es) ${JSON.stringify(heroIds)}, position: ${positionKey} in ${leagueIds.length} leagues (take: ${solicitadoTake}, skip: ${solicitadoSkip})...`
      );

      const query = `
        query ProPlayerMatches(
          $heroIds: [Short!]!,
          $leagueIds: [Int!],
          $gameVersionIds: [Int!],
          $take: Int,
          $skip: Int,
          $positionKey: MatchPlayerPositionType 
        ) {
          player {
            proSteamAccounts {
              steamAccountId
              name
              matches(
                request: {
                  heroIds: $heroIds,
                  leagueIds: $leagueIds,
                  gameVersionIds: $gameVersionIds,
                  isVictory: true,
                  isStats: true,
                  take: $take,
                  skip: $skip,
                  positionIds: [$positionKey] 
                }
              ) {
                matchId
                heroId
              }
            }
          }
        }
      `;

      const variables = {
        heroIds: heroIds,
        leagueIds: leagueIds,
        gameVersionIds: [this.PATCH_ID],
        take: solicitadoTake,
        skip: solicitadoSkip,
        positionKey: positionKey,
      };

      const data = await this.graphqlClient.request(query, variables);

      if (!data || !data.player || !data.player.proSteamAccounts) {
        console.warn('[fetchRecentProMatches] No proSteamAccounts data returned from Stratz.');
        return [];
      }

      let allPlayerMatches = [];
      data.player.proSteamAccounts.forEach((account) => {
        if (account.matches && account.matches.length > 0) {
          const matchesWithProInfo = account.matches.map((match) => ({
            ...match,
            proPlayerName: account.name,
            proPlayerSteamId: account.steamAccountId,
          }));
          allPlayerMatches.push(...matchesWithProInfo);
        }
      });

      const uniqueMatchMap = new Map();
      allPlayerMatches.forEach((match) => {
        if (!uniqueMatchMap.has(match.matchId)) {
          uniqueMatchMap.set(match.matchId, match);
        }
      });
      const uniqueMatches = Array.from(uniqueMatchMap.values());

      console.log(
        `[fetchRecentProMatches] Found ${uniqueMatches.length} unique relevant pro matches initially (before full details fetch).`
      );
      if (uniqueMatches.length === 0) {
        return [];
      }

      console.log(
        `[fetchRecentProMatches] Step 3: Fetching full details for ${uniqueMatches.length} matches...`
      );
      const detailedMatches = [];
      for (const match of uniqueMatches) {
        try {
          const matchDetails = await this.fetchMatchDetails(match.matchId);
          if (matchDetails) {
            detailedMatches.push({
              ...matchDetails,
              proPlayerName: match.proPlayerName,
              proPlayerSteamId: match.proPlayerSteamId,
            });
          }
        } catch (detailError) {
          console.error(
            `[fetchRecentProMatches] Error fetching details for match ${match.matchId}:`,
            detailError.message
          );
        }
      }
      console.log(
        `[fetchRecentProMatches] Step 3: Successfully fetched full details for ${detailedMatches.length} matches.`
      );

      const targetHeroId = heroIds[0];
      if (targetHeroId === undefined) {
        console.error(
          '[fetchRecentProMatches] Target heroId is undefined, cannot process matches for skill build.'
        );
        return [];
      }

      const processedMatches = DataProcessor.processMatchDataForSkillBuild(
        detailedMatches,
        targetHeroId,
        this.ABILITY_MAP,
        positionKey
      );

      console.log(
        `[fetchRecentProMatches] Step 4: Found ${processedMatches.length} relevant WON matches with skills for hero ${targetHeroId} at position ${positionKey}.`
      );

      return processedMatches;
    } catch (error) {
      console.error('[fetchRecentProMatches] Error fetching or processing pro matches:', error);
      if (error.response && error.response.errors) {
        console.error(
          '[fetchRecentProMatches] GraphQL Errors:',
          JSON.stringify(error.response.errors, null, 2)
        );
      }
      return [];
    }
  }

  // This is the new function that tries to use heroPerformance to get match IDs
  // This was the latest attempt before deciding to repurpose fetchProSkillBuildMatches
  /*
  async fetchSkillBuildMatchIds(heroIds, rankApiKey, positionKey, gameModeId = 2, solicitadoTake = DEFAULT_MATCHES_TO_ANALYZE, solicitadoSkip = 0) {
    // ... previous implementation targeting heroPerformance ...
  }
  */

  async fetchMatchDetails(matchId) {
    await this.initializationPromise;
    console.log(`🔄 Fetching details for match: ${matchId}`);

    const query = `
      query GetMatchDetails($matchId: Long!) {
        match(id: $matchId) {
          id
          didRadiantWin
          durationSeconds
          startDateTime
          gameMode
          players {
            heroId
            steamAccountId # Useful for identifying the specific player if needed
            isRadiant
            isVictory
            position
            abilities {
              abilityId
              time
              level # This is hero level when skill was taken
            }
            # Consider adding items or other stats if needed later
            # inventory { itemId } 
            # networth
            # kills
            # deaths
            # assists
          }
        }
      }
    `;

    const variables = {
      matchId: parseInt(matchId, 10), // Ensure matchId is a number if it comes as string
    };

    console.log(
      `[StratzService DEBUG] fetchMatchDetails variables: ${JSON.stringify(variables, null, 2)}`
    );

    try {
      // Use this.graphqlClient.request instead of axios
      const response = await this.graphqlClient.request(query, variables);
      console.log(
        `[StratzService DEBUG] Raw response from fetchMatchDetails for match ${matchId}: ${JSON.stringify(response, null, 2)}`
      );
      if (response && response.match) {
        return response.match; // Returns the full match object
      } else {
        console.warn(
          `[StratzService WARN] fetchMatchDetails for match ${matchId} returned unexpected structure or no data.`
        );
        return null;
      }
    } catch (error) {
      console.error(`❌ Error fetching match details for match ${matchId}:`, error.message); // Log the basic message
      if (error.response && error.response.errors) {
        console.error(
          `   GraphQL Errors from API for match ${matchId}:`,
          JSON.stringify(error.response.errors, null, 2)
        );
      }
      if (error.response && typeof error.response.data !== 'undefined') {
        // Corrected typeof comparison
        console.error(
          `   Response Data from API for match ${matchId} (if any):`,
          JSON.stringify(error.response.data, null, 2)
        );
      }
      throw error;
    }
  }

  async fetchPatchData(_days = 7) {
    console.log(`🔄 Fetching patch data...`);
    const gqlQuery = `
      query {
        constants {
          gameVersions {
            id
            name
            asOfDateTime
          }
        }
      }
    `;
    try {
      const response = await this.graphQLRequest(gqlQuery, {}, true);

      const constantsData = response?.data?.constants; // graphQLRequest likely returns {data: ...} if returnRaw=true

      if (
        constantsData &&
        constantsData.gameVersions &&
        Array.isArray(constantsData.gameVersions) &&
        constantsData.gameVersions.length > 0
      ) {
        const allGameVersions = constantsData.gameVersions;
        const nowTimestamp = Math.floor(Date.now() / 1000);
        console.log(
          `[fetchPatchData DEBUG] Current 'nowTimestamp': ${nowTimestamp} (Human: ${new Date(nowTimestamp * 1000).toUTCString()})`
        );

        const releasedPatches = allGameVersions.filter(
          (patch) => patch.asOfDateTime <= nowTimestamp
        );

        if (releasedPatches.length > 0) {
          const sortedReleasedPatches = [...releasedPatches].sort(
            (a, b) => b.asOfDateTime - a.asOfDateTime
          );

          this.PATCH_ID = sortedReleasedPatches[0].id;
          this.currentPatchReleaseDateTime = sortedReleasedPatches[0].asOfDateTime;
          console.log(
            `✅ [fetchPatchData] Latest ACTIVE patch ID: ${this.PATCH_ID} (${sortedReleasedPatches[0].name}), Released: ${this.currentPatchReleaseDateTime} (Human: ${new Date(this.currentPatchReleaseDateTime * 1000).toUTCString()})`
          );
        } else {
          console.warn(
            `⚠️ [fetchPatchData] No released game versions found. Falling back to default patch ID and a generic recent past date.`
          );
          this.PATCH_ID = DEFAULT_PATCH_ID;
          this.currentPatchReleaseDateTime = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
          console.warn(
            `[fetchPatchData] Using fallback patch ID: ${this.PATCH_ID} and fallback release time: ${this.currentPatchReleaseDateTime} (Human: ${new Date(this.currentPatchReleaseDateTime * 1000).toUTCString()})`
          );
        }
      } else {
        console.error('❌ [fetchPatchData] Error: Could not retrieve gameVersions from constants.');
        this.PATCH_ID = DEFAULT_PATCH_ID;
        this.currentPatchReleaseDateTime = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
        console.warn(
          `⚠️ [fetchPatchData] Using default patch ID and fallback time due to API error or no gameVersions.`
        );
      }
    } catch (error) {
      console.error('❌ [fetchPatchData] Error fetching patch data:', error.message);
      if (error.details) {
        console.error(
          '[fetchPatchData] GraphQL Error Details:',
          JSON.stringify(error.details, null, 2)
        );
      }
      this.PATCH_ID = DEFAULT_PATCH_ID;
      this.currentPatchReleaseDateTime = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
      console.warn(
        `⚠️ [fetchPatchData] Using default patch ID and fallback time due to exception.`
      );
    }
  }

  async graphQLRequest(query, variables, returnRaw = false) {
    if (!this.graphqlClient) {
      console.error('❌ graphQLRequest error: graphqlClient is not initialized.');
      throw new Error('graphqlClient not initialized in StratzService');
    }
    try {
      const data = await this.graphqlClient.request(query, variables);
      // For graphql-request, `data` is the direct JSON response (the `data` field of the GraphQL response payload).
      // If `returnRaw` is true, and the intention was to get an object like { data: ..., errors: ... },
      // this needs adjustment as graphql-request throws on errors.
      // Assuming `returnRaw` true means the caller expects the raw {data: ...} object, which `graphql-request` provides as `data`.
      // So, if `returnRaw` is true, `fetchPatchData` expects `response.data.constants`. So response should be `{ data: dataFromGraphQLClient }`
      return returnRaw ? { data: data } : data;
    } catch (error) {
      console.error('❌ Error in graphQLRequest:', error.message);
      if (error.response && error.response.errors) {
        console.error('GraphQL Error Details:', JSON.stringify(error.response.errors, null, 2));
        const gqlError = new Error('GraphQL query failed within graphQLRequest');
        gqlError.details = error.response.errors;
        throw gqlError;
      }
      throw error;
    }
  }
}

module.exports = StratzService;
