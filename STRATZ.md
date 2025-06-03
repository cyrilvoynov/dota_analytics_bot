# Stratz API Usage Documentation

This document outlines how the Dota Analytics Bot interacts with the Stratz API, focusing on the queries and logic used for fetching data, especially for skill build generation.

## Authentication

All requests to the Stratz GraphQL API require an authentication token. The bot retrieves this token from the `.env` file (`STRATZ_API_TOKEN`) and includes it in the `Authorization: Bearer <token>` header for all API calls.

## Core Data Fetching Strategy for Skill Builds (Current)

The primary goal is to gather recent, high-quality match data for a specific hero, played in a specific position, on the current game patch. This involves a multi-step process:

### 1. Determining the Current Game Patch (`PATCH_ID`)

*   **Endpoint**: `constants` (general game constants)
*   **Query**: Fetches `gameVersions { id, name, asOfDateTime }`.
*   **Logic (`fetchPatchData` in `StratzService.js`)**:
    *   Retrieves all game versions from Stratz.
    *   Filters these versions to include only those where `asOfDateTime` (patch release timestamp) is less than or equal to the bot's current server timestamp (`Date.now()`). This ensures patches scheduled for the future are excluded.
    *   The list of valid, released patches is sorted in descending order by `asOfDateTime`.
    *   The `id` of the most recent patch (e.g., `179` for 7.36b) is stored as `this.PATCH_ID` in `StratzService`.
    *   This `PATCH_ID` is used globally within the service to filter matches and ensure data relevance.
*   **Stratz Server Time Skew Note**: While the Stratz server's clock might be skewed, this step relies on the `asOfDateTime` provided by Stratz for each patch and compares it against the bot's reliable local time. This makes patch identification robust.

### 2. Fetching Recent League IDs (`RecentLeagues` Query)

*   **Purpose**: To identify recent professional leagues where relevant matches might be found.
*   **Query Name (in code)**: `RecentLeagues`
*   **GraphQL Snippet**:
    ```graphql
    query RecentLeagues($startDateTime: Long!, $endDateTime: Long!) {
      leagues(request: {
        startDateTime: $startDateTime,
        endDateTime: $endDateTime,
        tiers: [PROFESSIONAL],
        take: 250 # Fetch a good number of recent leagues
      }) {
        id
        name
        startDateTime
        endDateTime
      }
    }
    ```
*   **Key Variables & Logic (`fetchRecentProMatches` in `StratzService.js`)**:
    *   `$startDateTime`: Due to the Stratz API server's clock being significantly ahead of actual time, this timestamp is hardcoded to a "future" date (e.g., April 1, 2025, timestamp `1743532800`). This is a workaround to get leagues that Stratz considers "recent" relative to its own skewed clock.
    *   `$endDateTime`: Calculated as 60 days after `$startDateTime`.
    *   `tiers: [PROFESSIONAL]`: Focuses on high-level professional matches.
*   **Output**: A list of league IDs.

### 3. Fetching Match Stubs from Leagues (`LeagueMatchesPage` Query)

*   **Purpose**: For each league ID obtained in Step 2, fetch a list of match "stubs" (basic match info) that meet certain criteria.
*   **Query Name (in code)**: `LeagueMatchesPage` (iterated for each league ID)
*   **GraphQL Snippet**:
    ```graphql
    query LeagueMatchesPage($leagueId: Long!, $heroIds: [Short!], $skip: Int!, $take: Int!) {
      league(id: $leagueId) {
        matches(request: {
          heroIds: $heroIds,       # Filter by target hero ID
          isParsed: true,         # Ensure match is parsed
          isStats: true,          # Ensure stats are available
          # positionIds: [$positionKey] # This filter exists but currently not used at this stage; position is filtered later from player data
          skip: $skip,
          take: $take
        }) {
          id # Match ID
          gameVersionId
          players {
            heroId
            steamAccountId
            position
          }
        }
      }
    }
    ```
*   **Key Variables & Logic (`fetchRecentProMatches` in `StratzService.js`)**:
    *   `$leagueId`: The ID of the league currently being queried.
    *   `$heroIds`: An array containing the target hero's ID (e.g., `[103]` for Dark Willow).
    *   `$skip`, `$take`: Used for pagination within each league to retrieve all relevant matches, up to a service-defined limit (e.g., `MATCHES_PER_LEAGUE_PAGE`).
    *   `isParsed: true`, `isStats: true`: Crucial filters to ensure that only matches with complete data (necessary for skill build analysis) are requested.
*   **Output**: A list of match stubs. Each stub includes `id` (matchId), `gameVersionId`, and a `players` array (containing `heroId` and `position` for each player in that match).
*   **Service-Side Pre-filtering**: After fetching these stubs:
    *   Matches whose `gameVersionId` does not match `this.PATCH_ID` are discarded.
    *   Matches where the target hero (from `$heroIds`) is not found playing the target `positionKey` (derived from user request, e.g., 'POSITION_1') within the `players` array are discarded.

### 4. Fetching Full Match Details (`GetMatchDetails` Query)

*   **Purpose**: For the unique match IDs that passed the pre-filtering in Step 3, fetch complete match details.
*   **Query Name (in code)**: `GetMatchDetails` (iterated for each relevant match ID)
*   **GraphQL Snippet**:
    ```graphql
    query GetMatchDetails($matchId: Long!) {
      match(id: $matchId) {
        id
        gameVersionId
        players {
          heroId
          steamAccountId
          isRadiant
          isVictory
          position
          level
          abilityUpgradeEvents {
            abilityId
            level
            time
          }
          # ... other player stats if needed ...
        }
        # ... other match details if needed ...
      }
    }
    ```
*   **Key Variables & Logic (`fetchRecentProMatches` and `fetchMatchDetails` in `StratzService.js`)**:
    *   `$matchId`: The ID of the match for which details are being fetched.
*   **Output**: A detailed match object, critically containing `abilityUpgradeEvents` for each player, which lists the sequence of skilled abilities.
*   **Service-Side Final Filtering**: After fetching detailed data:
    *   A final check ensures `match.gameVersionId` matches `this.PATCH_ID`.

### 5. Data Processing

The collected and filtered detailed match data (specifically the `abilityUpgradeEvents` for the target hero on the target position in the target patch) is then passed to `DataProcessor.js` to aggregate skill picks at each level and construct the `mostPopularBuild`.

## Deprecated Strategies

*   **`player.proSteamAccounts`**: An earlier approach attempted to fetch matches directly via `player { proSteamAccounts { matches(...) } }`. This was abandoned due to Stratz API schema changes that made this query structure unsuitable for fetching a general list of recent pro matches for a hero (it now seems to require a specific `steamAccountId` for the `player` field).
*   **`abilityMinLevel` / `abilityMaxLevel` from `constants`**: The very first iteration of skill build logic used these fields from the `constants.abilities` endpoint. This was found to be too generic and often not reflective of actual, patch-specific popular builds, leading to the current match-analysis approach.

## Other Notable Queries

*   **`fetchHeroStats`**: Used for fetching general hero statistics like win rates and pick rates for different ranks and positions. Used by the cache warming mechanism to identify popular heroes.
*   **`fetchHeroAbilityBuildData` (Old/Direct API for Ability Data - Potentially Deprecated for Skill Builds)**: Previously, this function might have queried specific ability popularity directly (e.g., `heroStats.ability` endpoint). While the endpoint might still exist, the primary skill build generation now relies on analyzing `abilityUpgradeEvents` from full match data for higher accuracy.

This documentation should be updated as the bot's interaction with the Stratz API evolves. 