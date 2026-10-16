/**
 * Configuration shared by every module.
 *
 * Apps Script has no imports. Every file shares one global scope, so anything
 * declared at the top level of a file can be used from any other file at call
 * time. Top level code in these files must not depend on another file.
 */

// ── Secrets (Script Properties, never hard coded) ──
const TELEGRAM_TOKEN = PropertiesService.getScriptProperties().getProperty('TELEGRAM_TOKEN');
const GEMINI_API_KEY = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');

// ── Sheet tab names ──
const SHEET = {
    LOGS: 'Logs',
    DASHBOARD: 'Dashboard',
    PRESETS: 'Presets',
    MACRO_CACHE: 'Macro Cache',
    WEEKLY_SUMMARY: 'Weekly Summary',
    WEIGHT: 'Weight',
    SETTINGS: 'Settings',
    DAILY: 'Daily'
};

// ── Settings sheet rows (value in column B) ──
const SETTINGS_ROW = { CALORIES: 2, PROTEIN: 3, CARBS: 4 };

// ── Logs sheet columns (1 based) ──
const LOG_COL = {
    DATE: 1,
    TIME: 2,
    RAW_INPUT: 3,
    FOOD_ITEM: 4,
    CALORIES: 5,
    PROTEIN: 6,
    CARBS: 7,
    FATS: 8,
    ENTRY_ID: 9    // set by the bot. Rows you add by hand may leave this blank
};

// ── CacheService lifetimes (seconds) ──
// CacheService (~20-50ms) is far faster than Sheets I/O (~200-500ms).
const CACHE_TTL_SHORT = 600;    // 10 min, presets and the weekly row flag
const CACHE_TTL_LONG = 21600;   // 6 hours (the maximum), macro cache and handled updates

// ── Security ──
/** Only the one whitelisted Telegram chat may use the bot. */
function isAuthorized(chatId) {
    const allowed = PropertiesService.getScriptProperties().getProperty('ALLOWED_CHAT_ID');
    if (!allowed) return false;
    return chatId.toString() === allowed;
}
