# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - 2025-06-03

### Added
- `CHANGELOG.md` to track project changes and development history.

### Changed
- **Documentation:**
    - Updated `README.md` (English) with the latest detailed skill build generation logic, including Stratz API interactions, patch ID determination, and workarounds for API time skew.
    - Updated `README_RU.md` (Russian) to align with the changes in the English `README.md`.
    - Updated `STRATZ.md` to provide a comprehensive guide on Stratz API usage for the project, detailing queries for skill builds, patch data, and known workarounds.
- **Code Maintenance:**
    - Cleaned up extensive debug `console.log` statements from `src/services/stratzService.js` to improve code readability and performance.
- Adjusted dates in `CHANGELOG.md` to reflect the user's current timeline (June 2025).

## [0.2.0] - 2025-06-02

### Fixed
- **Critical Stratz API Skill Build Fetching (`fetchRecentProMatches` in `StratzService.js`):**
    - Resolved the primary issue of fetching matches for the correct game patch (`this.PATCH_ID`, e.g., 179). This was achieved by adjusting `leagueQueryStartDateTime` to April 1, 2025. This change makes the Stratz API return leagues and subsequent matches that are recent enough to contain data for the current game patch, effectively working around Stratz's server time being significantly in the future.
    - Ensured that the `players` array (containing hero and position information) from match stubs is correctly passed into `allMatchesFromLeagues`. This fixed a bug where pre-filtering by hero/position on match stubs was failing.
    - Reverted temporary hardcoding of `gameVersionId` (e.g., to `173`) in match filters back to using the dynamically determined `this.PATCH_ID`.

### Changed
- **Stratz API Interaction for Skill Builds (`fetchRecentProMatches` in `StratzService.js`):**
    - Re-enabled and confirmed the functionality of the `heroIds: [$targetHeroId]` filter within the `LeagueMatchesPage` GraphQL query to fetch matches specifically for the target hero.
    - Solidified the two-stage match filtering process:
        1.  Initial pre-filtering on match stubs (data from `LeagueMatchesPage`) by `gameVersionId` (`this.PATCH_ID`), target `heroId`, and target `positionKey`.
        2.  Final filtering on full match details (data from `GetMatchDetails`) by `gameVersionId` (as a safeguard) and ensuring the target hero played the specified position.

## [0.1.5] - 2025-05-30

### Added
- **New Stratz API Match Fetching Strategy for Skill Builds:**
    - Implemented a new primary method in `fetchRecentProMatches` to fetch match data using the `league(id: $leagueId).matches(...)` GraphQL query. This replaced the previous `player.proSteamAccounts` approach which became non-viable due to Stratz API schema changes.
    - Incorporated `isParsed: true` and `isStats: true` filters into the `league.matches` query to ensure data quality and completeness for analysis.
- Added the `endDateTime` parameter to the `RecentLeagues` GraphQL query in `fetchRecentProMatches` (calculated as 60 days after `startDateTime`) as it became a required field by the Stratz API.

### Fixed
- **Stratz API `RecentLeagues` Query (400 Bad Request Errors):**
    - Corrected the `tiers` argument in the `RecentLeagues` query from `[PROFESSIONAL, PREMIUM]` to `[PROFESSIONAL]`, as `PREMIUM` was identified as an invalid `LeagueTier` enum value.
    - Successfully fetched league IDs by adding `endDateTime` and further refining the `startDateTime` workaround for Stratz's server time skew (setting it to a "future" date like April 1, 2025, after experiments with earlier dates like May 1, 2024).
- **Stratz API `player.proSteamAccounts` Query (400 Bad Request Errors):**
    - Identified that this query path was consistently failing due to unannounced Stratz API schema changes. The `player` root field now seems to require a specific `steamAccountId` and no longer supports `proSteamAccounts` for general match list queries. This discovery was pivotal in shifting to the `league.matches` strategy.
- Resolved an accidental file truncation issue in `src/services/stratzService.js` that occurred during one of the many refactoring sessions.
- **Bot Functionality:**
    - Fixed `Error: Cannot find module './utils/messageUtils'` by creating the missing `src/utils/messageUtils.js` file and adding an `escapeHTML` utility function.
    - Addressed an error where `heroName` or `position` was missing in `userState[chatId].selectedHero`. The `build_skill_` callback handler in `src/index.js` was updated to correctly source `heroName` from `userState[chatId].selectedHero.name` and `positionKey` from `userState[chatId].position`.

### Changed
- **Skill Build Logic (`DataProcessor.processMatchDataForSkillBuild`):**
    - Refined logic to prevent ultimate abilities from being skilled before level 6.
    - Ensured that the maximum level for each ability is respected when constructing the `mostPopularBuild` sequence.

## [0.1.0] - 2025-05-27

### Added
- **Skill Build Caching System:**
    - Implemented file-based caching for generated skill builds to improve performance and reduce API load. Cached data is stored in `cache/skill_builds/HERO_ID-POSITION_KEY.json` and is valid for 7 days.
- **Proactive Skill Build Cache Warming:**
    - Introduced a daily cron job (scheduled for 3 AM MSK using `node-cron`) to automatically update the cache for a list of top N (currently 2) heroes for each of the 5 standard positions.
    - Added `fetchTopHeroesByPositionForCacheWarmup(rankApiKey, topN)` method to `StratzService.js` to retrieve target heroes for warming. This function fetches hero stats and processes them to identify popular heroes per position.
    - Implemented `warmUpSkillBuildCache()` in `src/index.js` to orchestrate the cache warming process.
    - Added logic to clear `StratzService` from `require.cache` at the start of `src/index.js` as a proactive measure against potential module caching issues.

### Changed
- **Core Skill Build Generation Strategy (Major Refactor):**
    - Fundamentally changed the approach for generating skill builds. Moved away from relying on pre-aggregated Stratz API statistics (like `abilityMinLevel` and `abilityMaxLevel`).
    - The new strategy involves:
        1. Fetching a list of recent, won matches for a specific hero, rank (defaulting to "pro"), and position.
        2. Fetching detailed match data for these matches, including `abilityUpgradeEvents`.
        3. Processing these events in `DataProcessor.processMatchDataForSkillBuild` to determine the most popular skill upgrade sequence level by level.
    - This involved significant refactoring in `StratzService.js` (introducing `fetchRecentProMatches` and enhancing `fetchMatchDetails`) and `DataProcessor.js` (new `processMatchDataForSkillBuild` method).
- **Hotkeys:**
    - Temporarily addressed hotkey inconsistencies for heroes like Elder Titan by hardcoding mappings in `DataProcessor.processGameConstants` while investigating more robust solutions.

### Fixed
- **Node.js Module Caching:** Resolved a critical issue where `DataProcessor.js` was not reflecting code changes due to Node.js module caching. Implemented clearing of `require.cache` for `DataProcessor.js` during bot startup and before critical operations involving it.
- **Initial GraphQL Query Issues:** Addressed various errors and unexpected behaviors in GraphQL queries during the initial refactoring phase for the new skill build logic.
- **Patch Date Logic:** Refined the logic in `fetchPatchData` in `StratzService.js` for more reliable determination of the current game `PATCH_ID` by comparing patch `asOfDateTime` with the bot's server time.
- **API Rate Limiting:** Implemented basic delays and error handling to mitigate Stratz API rate limiting issues encountered during bulk fetching of match details. 