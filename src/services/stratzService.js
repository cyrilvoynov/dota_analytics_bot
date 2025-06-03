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
      const [, rawConstantsResult] = await Promise.allSettled([
        this.fetchPatchData(),
        this.fetchRawConstants(),
      ]);

      const {
        HERO_MAP: hMap,
        ABILITY_MAP: aMap,
        ITEM_MAP: iMap,
      } = DataProcessor.processGameConstants(rawConstantsResult.value);
      this.HERO_MAP = hMap;
      this.ABILITY_MAP = aMap;
      this.ITEM_MAP = iMap;

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
        throw new Error('GraphQL error while fetching raw constants.');
      }

      // Then check if data and data.constants exist
      if (res.data && res.data.data && res.data.data.constants) {
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

      const validateItem = (item) => {
        if (!item || typeof item !== 'object') {
          console.warn('⚠️ Invalid item object:', item);
          return false;
        }
        if (typeof item.itemId !== 'number') {
          console.warn('⚠️ Missing or invalid itemId:', item);
          return false;
        }
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

    try {
      const response = await this.graphQLRequest(query, variables);
      if (response && response.heroStats && response.heroStats.ability) {
        return {
          level: response.heroStats.ability,
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
    );

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

    console.log(`[fetchRecentProMatches] Target Patch ID for match filtering: ${this.PATCH_ID}`);

    const leagueQueryStartDateTime = 1743532800; // Timestamp for April 1, 2025 00:00:00 UTC

    // Calculate endDateTime as 60 days after startDateTime
    const leagueQueryEndDateTime = leagueQueryStartDateTime + 60 * 24 * 60 * 60;

    try {
      console.log(
        `[fetchRecentProMatches] Step 0 (V3_CHECK): Using leagueQueryStartDateTime: ${new Date(
          leagueQueryStartDateTime * 1000
        ).toISOString()} (Timestamp: ${leagueQueryStartDateTime}) and leagueQueryEndDateTime: ${new Date(
          leagueQueryEndDateTime * 1000
        ).toISOString()} (Timestamp: ${leagueQueryEndDateTime}) for fetching league IDs.`
      );

      // Step 1: Fetch recent league IDs (RE-ENABLED)
      console.log('[fetchRecentProMatches] Step 1: Fetching recent league IDs...');
      const leagueIdQuery = `
        query RecentLeagues($startDateTime: Long!, $endDateTime: Long!) {
          leagues(request: {
            startDateTime: $startDateTime,
            endDateTime: $endDateTime,
            tiers: [PROFESSIONAL],
            take: 250
          }) {
            id
            name
          }
        }
      `;
      const leagueIdVariables = {
        startDateTime: leagueQueryStartDateTime,
        endDateTime: leagueQueryEndDateTime, // Add endDateTime to variables
      };
      const leagueIdData = await this.graphqlClient.request(leagueIdQuery, leagueIdVariables);

      const leagueIds = leagueIdData?.leagues?.map((l) => l.id).filter((id) => id != null);

      if (!leagueIds || leagueIds.length === 0) {
        console.warn(
          `[fetchRecentProMatches] No recent PROFESSIONAL league IDs found starting from ${new Date(
            leagueQueryStartDateTime * 1000
          ).toISOString()}. Cannot fetch pro matches.`
        );
        return [];
      }
      console.log(
        `[fetchRecentProMatches] Found ${leagueIds.length} league IDs: ${JSON.stringify(leagueIds)}`
      );

      // Step 2: Fetch matches from these leagues
      console.log(
        `[fetchRecentProMatches] Step 2: Fetching matches for hero(es) ${JSON.stringify(heroIds)}, position: ${positionKey} from ${leagueIds.length} leagues (target total matches: ${solicitadoTake})...`
      );

      let allMatchesFromLeagues = [];
      const MAX_MATCHES_PER_LEAGUE_QUERY = 25; // How many matches to request per league in one go
      let totalMatchesFetchedSoFar = 0;

      for (const leagueId of leagueIds) {
        if (totalMatchesFetchedSoFar >= solicitadoTake) {
          console.log(
            `[fetchRecentProMatches] Reached target match count (${solicitadoTake}), stopping league iteration.`
          );
          break;
        }

        let currentLeagueSkip = 0;
        const MAX_FETCH_ATTEMPTS_PER_LEAGUE = 5; // To prevent infinite loops if API keeps returning data
        let fetchAttemptsThisLeague = 0;

        console.log(`[fetchRecentProMatches] Querying league ID: ${leagueId}`);

        // Loop to paginate within a single league if needed
        while (
          fetchAttemptsThisLeague < MAX_FETCH_ATTEMPTS_PER_LEAGUE &&
          totalMatchesFetchedSoFar < solicitadoTake
        ) {
          fetchAttemptsThisLeague++;
          const matchesToRequestThisCall = Math.min(
            MAX_MATCHES_PER_LEAGUE_QUERY,
            solicitadoTake - totalMatchesFetchedSoFar
          );
          if (matchesToRequestThisCall <= 0) break;

          const leagueMatchesQuery = `
            query LeagueMatchesPage(
              $leagueId: Int!,
              $heroIds: [Short!],
              $take: Int!,
              $skip: Int!
            ) {
              league(id: $leagueId) {
                id
                name
                matches(request: { # MatchRequestType
                  heroIds: $heroIds,
                  isParsed: true,
                  isStats: true,
                  take: $take,
                  skip: $skip
                }) { # Returns [MatchType]
                  id # matchId
                  gameVersionId
                  players {
                    heroId
                    position
                  }
                }
              }
            }
          `;

          const leagueMatchesVariables = {
            leagueId: leagueId,
            heroIds: heroIds,
            take: matchesToRequestThisCall,
            skip: currentLeagueSkip,
          };

          try {
            console.log(
              `[fetchRecentProMatches] Fetching matches from league ${leagueId}, take: ${matchesToRequestThisCall}, skip: ${currentLeagueSkip}`
            );
            const leagueMatchesData = await this.graphqlClient.request(
              leagueMatchesQuery,
              leagueMatchesVariables
            );

            const matchesInLeague = leagueMatchesData?.league?.matches;
            if (matchesInLeague && matchesInLeague.length > 0) {
              matchesInLeague.forEach((match) => {
                // Ensure essential fields are present AND players array exists
                if (
                  match &&
                  match.id &&
                  match.gameVersionId &&
                  match.players &&
                  Array.isArray(match.players)
                ) {
                  allMatchesFromLeagues.push({
                    matchId: match.id,
                    gameVersionId: match.gameVersionId,
                    players: match.players, // <--- ДОБАВЛЕНО: передаем массив players
                  });
                } else {
                  console.warn(
                    `[fetchRecentProMatches] Skipping a match from league ${leagueId} due to missing id, gameVersionId, or players array. Match data:`,
                    JSON.stringify(match)
                  );
                }
              });
              totalMatchesFetchedSoFar = allMatchesFromLeagues.length; // Recalculate based on unique matches later if needed, for now raw count
              currentLeagueSkip += matchesInLeague.length;
              console.log(
                `[fetchRecentProMatches] Fetched ${matchesInLeague.length} matches from league ${leagueId}. Total so far (raw): ${totalMatchesFetchedSoFar}`
              );
              if (matchesInLeague.length < matchesToRequestThisCall) {
                // No more matches in this league for these filters
                break;
              }
            } else {
              console.log(
                `[fetchRecentProMatches] No more matches found in league ${leagueId} with current skip/filters.`
              );
              break; // Exit pagination loop for this league
            }
          } catch (leagueError) {
            console.error(
              `[fetchRecentProMatches] Error fetching matches for league ${leagueId}:`,
              leagueError.message
            );
            if (leagueError.response && leagueError.response.errors) {
              console.error(
                `   GraphQL Errors:`,
                JSON.stringify(leagueError.response.errors, null, 2)
              );
            }
            break; // Stop trying for this league on error
          }
        } // End of while loop for paginating a single league
        await new Promise((resolve) => setTimeout(resolve, 500)); // Small delay between league queries
      } // End of for loop iterating through leagueIds

      console.log(
        `[fetchRecentProMatches] Raw matches from leagues (before any filtering): ${allMatchesFromLeagues.length}`
      ); // DEBUG log

      // Step 2.5: Pre-filter matches based on gameVersionId, heroId, and positionKey FROM THE STUB DATA
      // This assumes heroIds is an array and we are interested in heroIds[0]
      const currentTargetHeroId = heroIds && heroIds.length > 0 ? heroIds[0] : null;

      const preFilteredMatches = allMatchesFromLeagues.filter((matchStub) => {
        if (matchStub.gameVersionId !== this.PATCH_ID) {
          return false;
        }
        // Ensure currentTargetHeroId is valid before proceeding with player check
        if (currentTargetHeroId === null) {
          return false;
        }
        if (!matchStub.players || !Array.isArray(matchStub.players)) {
          return false;
        }
        const playerInPosition = matchStub.players.find(
          (p) => p.heroId === currentTargetHeroId && p.position === positionKey
        );
        if (!playerInPosition) {
          return false;
        }
        return true;
      });

      console.log(
        `[fetchRecentProMatches] Matches after pre-filtering by patch, hero, and position from stubs: ${preFilteredMatches.length}`
      );

      // Deduplicate matches based on matchId
      const uniqueMatchMap = new Map();
      preFilteredMatches.forEach((match) => {
        // Iterate over preFilteredMatches
        if (!uniqueMatchMap.has(match.matchId)) {
          // Store whatever info might be useful, or just the ID if that's all that's needed for the next step
          uniqueMatchMap.set(match.matchId, { gameVersionId: match.gameVersionId });
        }
      });

      const uniqueMatchIdsToFetch = Array.from(uniqueMatchMap.keys()); // Get only IDs

      console.log(
        `[fetchRecentProMatches] Found ${uniqueMatchIdsToFetch.length} unique match IDs to fetch details for (after pre-filtering and deduplication).`
      );

      if (uniqueMatchIdsToFetch.length === 0) {
        return [];
      }

      // Limit to solicitadoTake if we somehow overshot due to batching
      const matchIdsToDetail = uniqueMatchIdsToFetch.slice(0, solicitadoTake);

      console.log(
        `[fetchRecentProMatches] Step 3: Fetching full details for ${matchIdsToDetail.length} matches...`
      );
      const detailedMatches = [];
      for (const matchIdToFetch of matchIdsToDetail) {
        // Iterating over pre-filtered and deduplicated match IDs
        try {
          const matchDetails = await this.fetchMatchDetails(matchIdToFetch);
          if (matchDetails) {
            detailedMatches.push(matchDetails);
          }
        } catch (detailError) {
          console.error(
            `[fetchRecentProMatches] Error fetching details for match ${matchIdToFetch}:`,
            detailError.message
          );
        }
      }
      console.log(
        `[fetchRecentProMatches] Step 3: Successfully fetched full details for ${detailedMatches.length} matches (after potential pre-skip).`
      );

      const targetHeroId = heroIds[0];
      if (targetHeroId === undefined) {
        console.error(
          '[fetchRecentProMatches] Target heroId is undefined, cannot process matches for skill build.'
        );
        return [];
      }

      // Filter detailedMatches by this.PATCH_ID (redundant if pre-skip worked, but safe)
      // And also by heroId and positionKey within the match's player list
      const filteredDetailedMatches = detailedMatches.filter((match) => {
        if (match.gameVersionId !== this.PATCH_ID) {
          console.log(
            `[fetchRecentProMatches] Skipping match ${match.id} (already detailed) due to gameVersionId mismatch (Expected: ${this.PATCH_ID}, Got: ${match.gameVersionId})`
          );
          return false;
        }

        // Since heroIds and positionKey filters were removed from LeagueMatchesPage query,
        // we MUST filter by them here, using data from the match object itself if available
        // The LeagueMatchesPage query was modified to include players { heroId, position }
        // Note: This filtering happens *before* fetching full match details if we adjust the flow.
        // However, current flow fetches all details then filters. Let's adapt the filter here.
        // The `match` object here is the result of `fetchMatchDetails`, which already has players array.

        const playerInPosition = match.players.find(
          (p) => p.heroId === targetHeroId && p.position === positionKey
        );
        if (!playerInPosition) {
          console.log(
            `[fetchRecentProMatches] Skipping match ${match.id} (after details): Target hero ${targetHeroId} not found in position ${positionKey}.`
          );
          return false;
        }
        return true;
      });

      if (filteredDetailedMatches.length === 0) {
        console.log(
          `[fetchRecentProMatches] No matches remaining after filtering by PATCH_ID ${this.PATCH_ID} and hero/position. Original detailed count: ${detailedMatches.length}`
        );
        return [];
      }
      console.log(
        `[fetchRecentProMatches] ${filteredDetailedMatches.length} matches remaining after filtering by PATCH_ID and hero/position.`
      );

      const processedMatches = DataProcessor.processMatchDataForSkillBuild(
        filteredDetailedMatches, // Use filtered matches
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
          gameVersionId
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

    try {
      const response = await this.graphqlClient.request(query, variables);
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

      // NEW CHECK: Ensure currentPatchReleaseDateTime is not in the future
      const nowTimestampFinalCheck = Math.floor(Date.now() / 1000);
      if (this.currentPatchReleaseDateTime > nowTimestampFinalCheck) {
        this.currentPatchReleaseDateTime = nowTimestampFinalCheck - 14 * 24 * 60 * 60; // 14 days ago
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

  async fetchTopHeroesByPositionForCacheWarmup(rankApiKey = 'pro', topN = 2) {
    await this.initializationPromise;
    if (!this.isInitialized()) {
      console.error('[CacheWarmup] StratzService not initialized.');
      return [];
    }

    console.log(
      `[CacheWarmup] Starting to fetch top ${topN} heroes for each position for rank: ${rankApiKey}`
    );
    const allPositions = ['POSITION_1', 'POSITION_2', 'POSITION_3', 'POSITION_4', 'POSITION_5'];
    const targetHeroPositionPairs = [];
    const uniqueHeroPositionSet = new Set();

    for (const positionKey of allPositions) {
      console.log(`[CacheWarmup] Fetching top heroes for position: ${positionKey}`);
      try {
        // fetchHeroStats возвращает массив объектов статы героев до применения DataProcessor.processHeroStats
        const rawHeroStatsForPosition = await this.fetchHeroStats(rankApiKey, [positionKey]);

        // Теперь применяем DataProcessor.processHeroStats к сырым данным
        // Используем низкий minMatchCount, т.к. для про-сцены матчей на героя может быть меньше
        const processedHeroes = DataProcessor.processHeroStats(rawHeroStatsForPosition, 10);

        if (processedHeroes && processedHeroes.length > 0) {
          const topNForThisPosition = processedHeroes.slice(0, topN);
          topNForThisPosition.forEach((hero) => {
            const pair = `${hero.heroId}-${positionKey}`;
            if (!uniqueHeroPositionSet.has(pair)) {
              targetHeroPositionPairs.push({
                heroId: hero.heroId,
                positionKey: positionKey,
                heroName: this.HERO_MAP[hero.heroId] || `Unknown Hero ${hero.heroId}`,
              });
              uniqueHeroPositionSet.add(pair);
            }
          });
        } else {
          console.log(
            `[CacheWarmup] No top heroes found for position: ${positionKey} after processing.`
          );
        }
      } catch (error) {
        console.error(
          `[CacheWarmup] Error fetching top heroes for position ${positionKey}:`,
          error.message
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 1500)); // 1.5 секунды задержки
    }

    console.log(
      `[CacheWarmup] Found ${targetHeroPositionPairs.length} unique hero/position pairs for cache warming: ${JSON.stringify(targetHeroPositionPairs)}`
    );
    return targetHeroPositionPairs;
  }
}

module.exports = StratzService;
