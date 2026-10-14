/**
 * Macro Cache, so the same text always logs the same numbers.
 *
 * Lookups go through three layers, fastest first.
 *   L0  request-scoped variable
 *   L1  CacheService
 *   L2  the "Macro Cache" sheet (permanent)
 */

const MACRO_CACHE_KEY = 'MACRO_CACHE_MAP';
const MACRO_CACHE_HEADERS = ['Normalized Input', 'Food Item', 'Calories', 'Protein', 'Carbs', 'Fats', 'First Logged'];

let _macroCacheMap = null;  // L0

/** Normalizes input for use as a cache key, lowercase with single spaces. */
function normalizeCacheKey(input) {
    return input.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Returns the full cache as a key to macros map. */
function getMacroCacheMap() {
    if (_macroCacheMap !== null) return _macroCacheMap;

    const cache = CacheService.getScriptCache();
    const cached = cache.get(MACRO_CACHE_KEY);
    if (cached) {
        _macroCacheMap = JSON.parse(cached);
        return _macroCacheMap;
    }

    const sheet = getSheet(SHEET.MACRO_CACHE);
    if (!sheet || sheet.getLastRow() <= 1) {
        _macroCacheMap = {};
        return _macroCacheMap;
    }

    const data = sheet.getDataRange().getValues();
    const map = {};
    for (let i = 1; i < data.length; i++) {
        const key = String(data[i][0]).trim();
        if (key) {
            map[key] = {
                foodItem: data[i][1],
                calories: Number(data[i][2]) || 0,
                protein: Number(data[i][3]) || 0,
                carbs: Number(data[i][4]) || 0,
                fats: Number(data[i][5]) || 0
            };
        }
    }

    _macroCacheMap = map;
    try { CacheService.getScriptCache().put(MACRO_CACHE_KEY, JSON.stringify(map), CACHE_TTL_LONG); } catch (e) { }
    return _macroCacheMap;
}

/** Returns the macros previously stored for this text, or null. */
function checkMacroCache(rawInput) {
    const key = normalizeCacheKey(rawInput);
    return getMacroCacheMap()[key] || null;
}

/** Stores macros for this text in the sheet and in CacheService. */
function writeMacroCache(rawInput, macros) {
    const cacheSheet = getOrCreateSheet(SHEET.MACRO_CACHE, MACRO_CACHE_HEADERS, true);

    const key = normalizeCacheKey(rawInput);
    const timeZone = Session.getScriptTimeZone();
    const timestamp = Utilities.formatDate(new Date(), timeZone, 'yyyy-MM-dd HH:mm');

    // L2, permanent storage
    cacheSheet.appendRow([key, macros.foodItem, macros.calories, macros.protein, macros.carbs, macros.fats, timestamp]);

    // L0 and L1
    const map = getMacroCacheMap();
    map[key] = {
        foodItem: macros.foodItem,
        calories: macros.calories,
        protein: macros.protein,
        carbs: macros.carbs,
        fats: macros.fats
    };
    _macroCacheMap = map;

    try { CacheService.getScriptCache().put(MACRO_CACHE_KEY, JSON.stringify(map), CACHE_TTL_LONG); } catch (e) { }
}
