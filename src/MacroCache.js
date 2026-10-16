/**
 * Macro Cache, so the same text always logs the same numbers.
 *
 * Each food is cached under its own CacheService key, so lookups stay fast and
 * there is no size limit to hit as the sheet grows (CacheService stores at most
 * 100 KB per key, which one big combined entry would eventually exceed).
 *
 *   L1  CacheService, one key per food
 *   L2  the "Macro Cache" sheet (permanent), searched on the server side
 */

const MACRO_CACHE_KEY_PREFIX = 'MC_';
const MACRO_CACHE_HEADERS = ['Normalized Input', 'Food Item', 'Calories', 'Protein', 'Carbs', 'Fats', 'First Logged'];

/** Normalizes input for use as a cache key, lowercase with single spaces. */
function normalizeCacheKey(input) {
    return input.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** CacheService key for a normalized input. Hashed so any length is safe. */
function macroCacheKey_(normalizedKey) {
    const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, normalizedKey, Utilities.Charset.UTF_8);
    const hex = bytes.map(b => ((b < 0 ? b + 256 : b)).toString(16).padStart(2, '0')).join('');
    return MACRO_CACHE_KEY_PREFIX + hex;
}

/** Returns the macros previously stored for this text, or null. */
function checkMacroCache(rawInput) {
    const key = normalizeCacheKey(rawInput);
    const cacheKey = macroCacheKey_(key);
    const cache = CacheService.getScriptCache();

    const cached = cache.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const entry = readMacroCacheRow_(key);
    if (entry) putMacroCacheEntry_(cacheKey, entry);
    return entry;
}

/** Looks the key up in the sheet without reading the whole thing. */
function readMacroCacheRow_(key) {
    const sheet = getSheet(SHEET.MACRO_CACHE);
    if (!sheet || sheet.getLastRow() <= 1) return null;

    const matches = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1)
        .createTextFinder(key)
        .matchEntireCell(true)
        .matchCase(true)
        .findAll();
    if (matches.length === 0) return null;

    // If a key appears twice, the later row wins
    const row = matches[matches.length - 1].getRow();
    const v = sheet.getRange(row, 1, 1, 6).getValues()[0];
    return {
        foodItem: v[1],
        calories: Number(v[2]) || 0,
        protein: Number(v[3]) || 0,
        carbs: Number(v[4]) || 0,
        fats: Number(v[5]) || 0
    };
}

function putMacroCacheEntry_(cacheKey, entry) {
    try { CacheService.getScriptCache().put(cacheKey, JSON.stringify(entry), CACHE_TTL_LONG); } catch (e) { }
}

/** Stores macros for this text in the sheet and in CacheService. */
function writeMacroCache(rawInput, macros) {
    const cacheSheet = getOrCreateSheet(SHEET.MACRO_CACHE, MACRO_CACHE_HEADERS, true);

    const key = normalizeCacheKey(rawInput);
    const timeZone = Session.getScriptTimeZone();
    const timestamp = Utilities.formatDate(new Date(), timeZone, 'yyyy-MM-dd HH:mm');

    // L2, permanent storage
    cacheSheet.appendRow([key, macros.foodItem, macros.calories, macros.protein, macros.carbs, macros.fats, timestamp]);

    // L1
    putMacroCacheEntry_(macroCacheKey_(key), {
        foodItem: macros.foodItem,
        calories: macros.calories,
        protein: macros.protein,
        carbs: macros.carbs,
        fats: macros.fats
    });
}
