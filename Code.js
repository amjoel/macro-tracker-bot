const TELEGRAM_TOKEN = PropertiesService.getScriptProperties().getProperty('TELEGRAM_TOKEN');
const GEMINI_API_KEY = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');

// ──────────────────────────────────────────────
//  PERFORMANCE: Request-Scoped Singletons
// ──────────────────────────────────────────────
// Each doPost is a fresh V8 isolate. These module-level variables
// ensure we only pay for I/O once per execution, not once per function.

let _ss = null;
let _sheets = {};

/** Returns the active spreadsheet, cached for the lifetime of this execution. */
function getSS() {
    if (!_ss) _ss = SpreadsheetApp.getActiveSpreadsheet();
    return _ss;
}

/** Returns a sheet by name, cached for the lifetime of this execution. */
function getSheet(name) {
    if (!(name in _sheets)) _sheets[name] = getSS().getSheetByName(name);
    return _sheets[name];
}

// ──────────────────────────────────────────────
//  PERFORMANCE: CacheService Layer
// ──────────────────────────────────────────────
// CacheService (~20-50ms) is 4-10x faster than Sheets I/O (~200-500ms).
// Used as an L1 cache for data that's read often but changes rarely.

const CACHE_TTL_SHORT = 600;    // 10 min — Presets, weekly row flag
const CACHE_TTL_LONG = 21600;  // 6 hours (max) — Macro Cache map

let _presetsData = null;   // Request-scoped: avoids even CacheService re-reads within one doPost
let _macroCacheMap = null;  // Request-scoped

/**
 * Returns all presets as an array of objects.
 * L0: request-scoped variable → L1: CacheService → L2: Sheet read.
 */
function getPresetsData() {
    if (_presetsData !== null) return _presetsData;

    const cache = CacheService.getScriptCache();
    const cached = cache.get('PRESETS_DATA');
    if (cached) {
        _presetsData = JSON.parse(cached);
        return _presetsData;
    }

    const sheet = getSheet('Presets');
    if (!sheet || sheet.getLastRow() <= 1) {
        _presetsData = [];
        return _presetsData;
    }

    const data = sheet.getDataRange().getValues();
    const presets = [];
    for (let i = 1; i < data.length; i++) {
        const shortcut = String(data[i][0]).trim();
        if (shortcut) {
            presets.push({
                shortcut: shortcut.toLowerCase(),
                shortcutDisplay: shortcut,
                itemName: data[i][1],
                calories: Number(data[i][2]) || 0,
                protein: Number(data[i][3]) || 0,
                carbs: Number(data[i][4]) || 0,
                fats: Number(data[i][5]) || 0
            });
        }
    }

    _presetsData = presets;
    try { cache.put('PRESETS_DATA', JSON.stringify(presets), CACHE_TTL_SHORT); } catch (e) { /* cache full — degrade gracefully */ }
    return _presetsData;
}

/** Clears presets from both CacheService and request-scoped memory. */
function invalidatePresetsCache() {
    _presetsData = null;
    try { CacheService.getScriptCache().remove('PRESETS_DATA'); } catch (e) { }
}

/**
 * Returns the full Macro Cache as a key→macros map.
 * L0: request-scoped → L1: CacheService → L2: Sheet read.
 */
function getMacroCacheMap() {
    if (_macroCacheMap !== null) return _macroCacheMap;

    const cache = CacheService.getScriptCache();
    const cached = cache.get('MACRO_CACHE_MAP');
    if (cached) {
        _macroCacheMap = JSON.parse(cached);
        return _macroCacheMap;
    }

    const sheet = getSheet('Macro Cache');
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
    try { cache.put('MACRO_CACHE_MAP', JSON.stringify(map), CACHE_TTL_LONG); } catch (e) { }
    return _macroCacheMap;
}

// ──────────────────────────────────────────────
//  DEFAULT GOALS
// ──────────────────────────────────────────────
const DEFAULT_GOALS = { calories: 2300, protein: 80, carbs: 300 };

function getGoals() {
    const props = PropertiesService.getScriptProperties();
    return {
        calories: Number(props.getProperty('GOAL_CALORIES')) || DEFAULT_GOALS.calories,
        protein: Number(props.getProperty('GOAL_PROTEIN')) || DEFAULT_GOALS.protein,
        carbs: Number(props.getProperty('GOAL_CARBS')) || DEFAULT_GOALS.carbs
    };
}

function setGoals(calories, protein, carbs) {
    const props = PropertiesService.getScriptProperties();
    props.setProperty('GOAL_CALORIES', calories.toString());
    props.setProperty('GOAL_PROTEIN', protein.toString());
    props.setProperty('GOAL_CARBS', carbs.toString());
}

// ──────────────────────────────────────────────
//  WEEKLY SUMMARY ROLLOVER (Automated)
// ──────────────────────────────────────────────

/**
 * Meant to be attached to a weekly time-driven trigger (every Monday).
 * Finalizes the previous week's row and creates a new one.
 * Can also be called manually via /rollover for testing.
 */
function runWeeklyRollover() {
    let summarySheet = getSheet('Weekly Summary');
    const timeZone = Session.getScriptTimeZone();
    const now = new Date();

    // Create sheet with headers if it doesn't exist
    if (!summarySheet) {
        summarySheet = getSS().insertSheet('Weekly Summary');
        summarySheet.appendRow(['Week Start (Mon)', 'Base Target', 'Rollover In', 'Total Budget', 'Actual Consumed', 'Deficit (Rollover Out)']);
        _sheets['Weekly Summary'] = summarySheet;
    }

    // Calculate this Monday (start of current week)
    const thisMonday = getMonday(now, timeZone);
    const thisMondayStr = Utilities.formatDate(thisMonday, timeZone, "yyyy-MM-dd");

    // Calculate previous Monday
    const prevMonday = new Date(thisMonday.getTime() - 7 * 24 * 60 * 60 * 1000);
    const prevMondayStr = Utilities.formatDate(prevMonday, timeZone, "yyyy-MM-dd");
    const prevSunday = new Date(thisMonday.getTime() - 1 * 24 * 60 * 60 * 1000);
    const prevSundayStr = Utilities.formatDate(prevSunday, timeZone, "yyyy-MM-dd");

    const goals = getGoals();
    const weeklyBaseTarget = goals.calories * 7;

    const data = summarySheet.getDataRange().getValues();

    // ── Update previous week's "Actual Consumed" if the row exists ──
    let prevRowIndex = -1;
    for (let i = 1; i < data.length; i++) {
        const rowDate = Utilities.formatDate(new Date(data[i][0]), timeZone, "yyyy-MM-dd");
        if (rowDate === prevMondayStr) {
            prevRowIndex = i + 1; // 1-indexed sheet row
            break;
        }
    }

    // Sum calories from Logs for the previous week (Mon–Sun)
    const logsSheet = getSheet('Logs');
    const logsData = logsSheet ? logsSheet.getDataRange().getValues() : [];
    const prevWeekConsumed = sumCaloriesFromData(logsData, prevMondayStr, prevSundayStr, timeZone);

    let rolloverOut = 0;

    if (prevRowIndex > 0) {
        const prevTotalBudget = Number(data[prevRowIndex - 1][3]) || weeklyBaseTarget;
        rolloverOut = prevTotalBudget - prevWeekConsumed;

        // Batch write: Actual Consumed + Deficit in one call
        summarySheet.getRange(prevRowIndex, 5, 1, 2).setValues([[prevWeekConsumed, rolloverOut]]);
    } else if (data.length > 1) {
        rolloverOut = Number(data[data.length - 1][5]) || 0;
    }

    // ── Check if this week's row already exists ──
    for (let i = 1; i < data.length; i++) {
        const rowDate = Utilities.formatDate(new Date(data[i][0]), timeZone, "yyyy-MM-dd");
        if (rowDate === thisMondayStr) return;
    }

    // ── Create new row for this week ──
    const rolloverIn = Math.max(rolloverOut, 0);
    const totalBudget = weeklyBaseTarget + rolloverIn;

    summarySheet.appendRow([
        thisMondayStr,
        weeklyBaseTarget,
        rolloverIn,
        totalBudget,
        0,
        totalBudget
    ]);

    // Flag this week as created
    try { CacheService.getScriptCache().put('WEEK_ROW_' + thisMondayStr, '1', CACHE_TTL_SHORT); } catch (e) { }
}

/**
 * Called on every doPost (for messages, not callbacks) to lazily ensure
 * the current week has a row. Uses CacheService to skip sheet reads
 * on 99% of requests.
 */
function ensureCurrentWeekRow() {
    const timeZone = Session.getScriptTimeZone();
    const thisMonday = getMonday(new Date(), timeZone);
    const thisMondayStr = Utilities.formatDate(thisMonday, timeZone, "yyyy-MM-dd");

    // L1: Check CacheService flag — avoids any sheet I/O
    const cache = CacheService.getScriptCache();
    if (cache.get('WEEK_ROW_' + thisMondayStr)) return;

    const summarySheet = getSheet('Weekly Summary');
    if (!summarySheet) {
        runWeeklyRollover();
        return;
    }

    const data = summarySheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
        const rowDate = Utilities.formatDate(new Date(data[i][0]), timeZone, "yyyy-MM-dd");
        if (rowDate === thisMondayStr) {
            // Row exists — set flag so we skip this check for the next 10 min
            try { cache.put('WEEK_ROW_' + thisMondayStr, '1', CACHE_TTL_SHORT); } catch (e) { }
            return;
        }
    }

    runWeeklyRollover();
}

/**
 * Updates the "Actual Consumed" and "Deficit" columns for the current week.
 * Called after every food log. Accepts pre-loaded Logs data to avoid re-reading.
 */
function updateCurrentWeekConsumed(logsData) {
    const summarySheet = getSheet('Weekly Summary');
    if (!summarySheet) return;

    const timeZone = Session.getScriptTimeZone();
    const thisMonday = getMonday(new Date(), timeZone);
    const thisMondayStr = Utilities.formatDate(thisMonday, timeZone, "yyyy-MM-dd");
    const thisSunday = new Date(thisMonday.getTime() + 6 * 24 * 60 * 60 * 1000);
    const thisSundayStr = Utilities.formatDate(thisSunday, timeZone, "yyyy-MM-dd");

    const data = summarySheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
        const rowDate = Utilities.formatDate(new Date(data[i][0]), timeZone, "yyyy-MM-dd");
        if (rowDate === thisMondayStr) {
            const sheetRow = i + 1;
            const totalBudget = Number(data[i][3]) || 0;
            const consumed = sumCaloriesFromData(logsData, thisMondayStr, thisSundayStr, timeZone);

            // Batch write: Actual Consumed + Deficit in one call
            summarySheet.getRange(sheetRow, 5, 1, 2).setValues([[consumed, totalBudget - consumed]]);
            return;
        }
    }
}

/** Helper: Sum calories from pre-loaded Logs data for a date range (inclusive). */
function sumCaloriesFromData(logsData, startDateStr, endDateStr, timeZone) {
    let total = 0;
    // Reverse iterate: logs are chronological, so we can break early
    // once we pass before the start of the date range.
    for (let i = logsData.length - 1; i >= 1; i--) {
        const rowDate = Utilities.formatDate(new Date(logsData[i][0]), timeZone, "yyyy-MM-dd");
        if (rowDate < startDateStr) break;   // all older rows are before our range
        if (rowDate <= endDateStr) {
            total += Number(logsData[i][4]) || 0;
        }
    }
    return total;
}

/** Helper: Get the Monday of the week containing the given date. */
function getMonday(date, timeZone) {
    const d = new Date(date);
    const dayStr = Utilities.formatDate(d, timeZone, "u"); // 1=Mon, 7=Sun
    const dayOfWeek = parseInt(dayStr, 10);
    const diff = dayOfWeek - 1;
    const monday = new Date(d.getTime() - diff * 24 * 60 * 60 * 1000);
    const mondayStr = Utilities.formatDate(monday, timeZone, "yyyy-MM-dd");
    return new Date(mondayStr + "T00:00:00");
}

// ──────────────────────────────────────────────
//  MACRO CACHE (Consistency for text inputs)
// ──────────────────────────────────────────────

/** Normalize input for cache key: lowercase, collapse whitespace, trim. */
function normalizeCacheKey(input) {
    return input.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Check for a previously-seen text input.
 * L0: request-scoped map → L1: CacheService → L2: Sheet read.
 */
function checkMacroCache(rawInput) {
    const key = normalizeCacheKey(rawInput);
    const map = getMacroCacheMap();
    return map[key] || null;
}

/**
 * Write a new entry to both the Macro Cache sheet (permanent) and
 * CacheService (fast future reads). Only for text-only lookups.
 */
function writeMacroCache(rawInput, macroData) {
    let cacheSheet = getSheet('Macro Cache');

    if (!cacheSheet) {
        cacheSheet = getSS().insertSheet('Macro Cache');
        cacheSheet.appendRow(['Normalized Input', 'Food Item', 'Calories', 'Protein', 'Carbs', 'Fats', 'First Logged']);
        cacheSheet.hideSheet();
        _sheets['Macro Cache'] = cacheSheet;
    }

    const key = normalizeCacheKey(rawInput);
    const timeZone = Session.getScriptTimeZone();
    const timestamp = Utilities.formatDate(new Date(), timeZone, "yyyy-MM-dd HH:mm");

    // L2: Permanent sheet storage
    cacheSheet.appendRow([key, macroData.foodItem, macroData.calories, macroData.protein, macroData.carbs, macroData.fats, timestamp]);

    // L0 + L1: Update in-memory map and CacheService
    const entry = {
        foodItem: macroData.foodItem,
        calories: macroData.calories,
        protein: macroData.protein,
        carbs: macroData.carbs,
        fats: macroData.fats
    };

    const map = getMacroCacheMap();
    map[key] = entry;
    _macroCacheMap = map;

    try { CacheService.getScriptCache().put('MACRO_CACHE_MAP', JSON.stringify(map), CACHE_TTL_LONG); } catch (e) { }
}

// ──────────────────────────────────────────────
//  SECURITY: Chat ID Whitelisting
// ──────────────────────────────────────────────
function isAuthorized(chatId) {
    const allowed = PropertiesService.getScriptProperties().getProperty('ALLOWED_CHAT_ID');
    if (!allowed) return false;
    return chatId.toString() === allowed;
}

// ──────────────────────────────────────────────
//  MAIN ENTRY POINT
// ──────────────────────────────────────────────
function doPost(e) {
    try {
        if (!e || !e.postData || !e.postData.contents) {
            return;
        }

        const contents = JSON.parse(e.postData.contents);
        console.log('doPost received update_id=' + contents.update_id +
            (contents.message && contents.message.text ? ' text="' + contents.message.text.substring(0, 40) + '"' : '') +
            (contents.callback_query ? ' callback' : ''));

        // ── 1. DEDUPLICATION: Ignore retried updates from Telegram ──
        if (contents.update_id) {
            const cache = CacheService.getScriptCache();
            const updateKey = 'UPDATE_' + contents.update_id;
            if (cache.get(updateKey)) {
                console.log('update_id=' + contents.update_id + ' is a resend, ignored');
                // Already processed this update; acknowledge and exit immediately
                return;
            }
            // Telegram can keep resending an update for a long time, so remember it
            // for the maximum CacheService lifetime (6 hours), not just 10 minutes.
            cache.put(updateKey, '1', CACHE_TTL_LONG);
        }

        // ── Handle Inline Callback Queries (Undo buttons) ──
        if (contents.callback_query) {
            handleCallbackQuery(contents.callback_query);
            return;
        }

        if (!contents.message) return;

        var chatId = contents.message.chat.id;

        // ── Security gate ────────────────────────
        if (!isAuthorized(chatId)) {
            sendTelegramMessage(chatId, "🚫 Unauthorized. This bot is private.");
            return;
        }

        // ── Text only for now. Photo logging is not supported yet ──
        if (!contents.message.text) {
            if (contents.message.photo && contents.message.photo.length > 0) {
                sendTelegramMessage(chatId, "📸 Photo logging isn't available yet. Please type what you ate instead.", getMainMenuKeyboard());
            }
            return;
        }

        const rawText = contents.message.text.trim();

        // ── 1. Handle Commands & Navigation ──────
        if (rawText === '/start' || rawText === '/help' || rawText === '🏠 Main Menu') {
            sendTelegramMessage(chatId, getHelpMessage(), getMainMenuKeyboard());
            return;
        }

        if (rawText === '/summary' || rawText === '📊 View Summary') {
            ensureCurrentWeekRow();
            sendSummaryMessage(chatId);
            return;
        }

        if (rawText === '/undo' || rawText === '↩️ Undo Last') {
            undoLastLog(chatId);
            return;
        }

        if (rawText.toLowerCase().startsWith('/weight') || rawText.toLowerCase().startsWith('weight ')) {
            handleWeightLogging(chatId, rawText);
            return;
        }

        if (rawText.toLowerCase().startsWith('/addpreset')) {
            handleAddPreset(chatId, rawText);
            return;
        }

        if (rawText.toLowerCase().startsWith('/setgoals')) {
            handleSetGoals(chatId, rawText);
            return;
        }

        if (rawText === '/goals' || rawText === '🎯 Goals') {
            handleViewGoals(chatId);
            return;
        }

        // ── Ensure weekly row exists before any food logging ──
        ensureCurrentWeekRow();

        // ── 2. Check Cooldown Before Hitting Gemini ────────
        const cache = CacheService.getScriptCache();
        if (cache.get('GEMINI_503_COOLDOWN')) {
            console.log('update_id=' + contents.update_id + ' blocked by overload cooldown');
            sendTelegramMessage(chatId, "⏳ *Gemini AI is currently overloaded.* Please wait a few minutes before trying again.", getMainMenuKeyboard());
            return;
        }

        // ── 3. Saved Presets ─────────────────────
        const preset = checkPreset(rawText);
        if (preset) {
            logToSheet(rawText, preset.itemName, preset.calories, preset.protein, preset.carbs, preset.fats);

            const logsData = getSheet('Logs').getDataRange().getValues();
            updateCurrentWeekConsumed(logsData);
            const progress = getDailyProgress();
            const lastRow = getSheet('Logs').getLastRow();

            sendTelegramMessage(
                chatId,
                `⚡ *Preset Logged!*\n\n` +
                `🍽 *Item:* ${preset.itemName}\n` +
                `🔥 *Calories:* ${preset.calories} kcal\n` +
                `💪 *Protein:* ${preset.protein}g | *Carbs:* ${preset.carbs}g | *Fat:* ${preset.fats}g\n\n` +
                formatDailyProgress(progress),
                getMainMenuKeyboard(),
                getUndoInlineKeyboard(lastRow)
            );
            return;
        }

        // ── 4. Cache lookup → Gemini API (Text) ────
        const cachedMacros = checkMacroCache(rawText);
        if (cachedMacros) {
            logToSheet(rawText, cachedMacros.foodItem, cachedMacros.calories, cachedMacros.protein, cachedMacros.carbs, cachedMacros.fats);

            const logsData = getSheet('Logs').getDataRange().getValues();
            updateCurrentWeekConsumed(logsData);
            const progress = getDailyProgress();
            const lastRow = getSheet('Logs').getLastRow();

            sendTelegramMessage(
                chatId,
                `🧠 *Logged from memory!*\n\n` +
                `🍽 *Item:* ${cachedMacros.foodItem}\n` +
                `🔥 *Calories:* ${cachedMacros.calories} kcal\n` +
                `💪 *Protein:* ${cachedMacros.protein}g | *Carbs:* ${cachedMacros.carbs}g | *Fat:* ${cachedMacros.fats}g\n\n` +
                formatDailyProgress(progress),
                getMainMenuKeyboard(),
                getUndoInlineKeyboard(lastRow)
            );
            return;
        }

        const macroData = getGeminiMacros(rawText);
        if (macroData) {
            writeMacroCache(rawText, macroData);
            logToSheet(rawText, macroData.foodItem, macroData.calories, macroData.protein, macroData.carbs, macroData.fats);

            const logsData = getSheet('Logs').getDataRange().getValues();
            updateCurrentWeekConsumed(logsData);
            const progress = getDailyProgress();
            const lastRow = getSheet('Logs').getLastRow();

            sendTelegramMessage(
                chatId,
                `✅ *Logged successfully!*\n\n` +
                `🍽 *Item:* ${macroData.foodItem}\n` +
                `🔥 *Calories:* ${macroData.calories} kcal\n` +
                `💪 *Protein:* ${macroData.protein}g | *Carbs:* ${macroData.carbs}g | *Fat:* ${macroData.fats}g\n\n` +
                formatDailyProgress(progress),
                getMainMenuKeyboard(),
                getUndoInlineKeyboard(lastRow)
            );
        } else {
            sendTelegramMessage(chatId, "⚠️ Could not parse macros. Please try again.", getMainMenuKeyboard());
        }

    } catch (err) {
        console.error("Error processing update: ", err);

        const cache = CacheService.getScriptCache();
        const isOverloaded = err.message && err.message.includes('currently overloaded');

        // ── COOLDOWN LOCK: Send 1 error message max every 3 minutes ──
        if (isOverloaded) {
            if (!cache.get('GEMINI_503_COOLDOWN')) {
                cache.put('GEMINI_503_COOLDOWN', '1', 180); // 3-minute lock
                if (chatId) {
                    sendTelegramMessage(chatId, "⏳ *Gemini AI is currently overloaded.* Please wait a few minutes before logging again.", getMainMenuKeyboard());
                }
            }
        } else {
            if (chatId) {
                const safeMsg = err.message.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
                sendTelegramMessage(chatId, `🛠️ *API Error:* ${safeMsg}`, getMainMenuKeyboard());
            }
        }
    }

    // Do not return ContentService output from doPost. Apps Script answers that
    // with a 302 redirect, which Telegram counts as a failed delivery and keeps
    // resending the update. Returning nothing gives Telegram a plain 200.
    return;
}

// ──────────────────────────────────────────────
//  INLINE UNDO CALLBACK HANDLER
// ──────────────────────────────────────────────
function handleCallbackQuery(callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    const data = callbackQuery.data;

    if (!isAuthorized(chatId)) {
        answerCallbackQuery(callbackQuery.id, "🚫 Unauthorized.");
        return;
    }

    if (data && data.startsWith("undo_row_")) {
        const rowNum = parseInt(data.replace("undo_row_", ""), 10);
        if (isNaN(rowNum) || rowNum <= 1) {
            answerCallbackQuery(callbackQuery.id, "⚠️ Invalid undo target.");
            return;
        }

        const logsSheet = getSheet('Logs');

        if (!logsSheet || rowNum > logsSheet.getLastRow()) {
            answerCallbackQuery(callbackQuery.id, "⚠️ Entry already removed.");
            editTelegramMessageRemoveInline(chatId, messageId);
            return;
        }

        const rowData = logsSheet.getRange(rowNum, 1, 1, 8).getValues()[0];
        const foodItem = rowData[3] || "Entry";

        logsSheet.deleteRow(rowNum);

        editTelegramMessage(
            chatId,
            messageId,
            `🗑️ *Undone:* "${foodItem}" has been removed from your logs.`
        );
        answerCallbackQuery(callbackQuery.id, `🗑️ "${foodItem}" removed!`);
    }
}

function answerCallbackQuery(callbackQueryId, text) {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`;
    UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({
            callback_query_id: callbackQueryId,
            text: text,
            show_alert: false
        })
    });
}

function getUndoInlineKeyboard(rowNumber) {
    return {
        inline_keyboard: [
            [{ text: "↩️ Undo This Entry", callback_data: `undo_row_${rowNumber}` }]
        ]
    };
}

// ──────────────────────────────────────────────
//  IN-CHAT PRESET CREATION
// ──────────────────────────────────────────────
function handleAddPreset(chatId, text) {
    // Expected format: /addpreset shortcut,Item Name,Calories,Protein,Carbs,Fats
    const afterCommand = text.replace(/^\/addpreset\s*/i, "").trim();

    if (!afterCommand) {
        sendTelegramMessage(
            chatId,
            "ℹ️ *Usage:*\n`/addpreset shortcut,Item Name,Calories,Protein,Carbs,Fats`\n\n" +
            "*Example:*\n`/addpreset morning oats,Oatmeal with Banana,350,12,55,8`",
            getMainMenuKeyboard()
        );
        return;
    }

    const parts = afterCommand.split(",").map(p => p.trim());

    if (parts.length < 4) {
        sendTelegramMessage(
            chatId,
            "⚠️ Not enough values. Need at least: `shortcut,Item Name,Calories,Protein`\n\n" +
            "Full format: `/addpreset shortcut,Item Name,Calories,Protein,Carbs,Fats`",
            getMainMenuKeyboard()
        );
        return;
    }

    const shortcut = parts[0];
    const itemName = parts[1];
    const calories = Number(parts[2]) || 0;
    const protein = Number(parts[3]) || 0;
    const carbs = parts.length > 4 ? (Number(parts[4]) || 0) : 0;
    const fats = parts.length > 5 ? (Number(parts[5]) || 0) : 0;

    if (!shortcut || !itemName) {
        sendTelegramMessage(chatId, "⚠️ Shortcut key and Item Name cannot be empty.", getMainMenuKeyboard());
        return;
    }

    let presetSheet = getSheet('Presets');

    if (!presetSheet) {
        presetSheet = getSS().insertSheet('Presets');
        presetSheet.appendRow(['Shortcut Key', 'Item Name', 'Calories', 'Protein', 'Carbs', 'Fat']);
        _sheets['Presets'] = presetSheet;
    }

    presetSheet.appendRow([shortcut, itemName, calories, protein, carbs, fats]);

    // Invalidate cache so getMainMenuKeyboard() picks up the new preset
    invalidatePresetsCache();

    sendTelegramMessage(
        chatId,
        `✅ *Preset Added!*\n\n` +
        `🔑 *Shortcut:* \`${shortcut}\`\n` +
        `🍽 *Item:* ${itemName}\n` +
        `🔥 *Calories:* ${calories} kcal\n` +
        `💪 *Protein:* ${protein}g | *Carbs:* ${carbs}g | *Fat:* ${fats}g\n\n` +
        `Just type \`${shortcut}\` to log it instantly!`,
        getMainMenuKeyboard()
    );
}

// ──────────────────────────────────────────────
//  EDITABLE GOALS
// ──────────────────────────────────────────────
function handleSetGoals(chatId, text) {
    const afterCommand = text.replace(/^\/setgoals\s*/i, "").trim();

    if (!afterCommand) {
        const current = getGoals();
        sendTelegramMessage(
            chatId,
            "ℹ️ *Set Your Daily Goals*\n\n" +
            "*Format:* `/setgoals Calories,Protein,Carbs`\n" +
            "*Example:* `/setgoals 2500,100,320`\n\n" +
            `*Current Goals:*\n` +
            `• Calories: ${current.calories} kcal\n` +
            `• Protein: ${current.protein}g\n` +
            `• Carbs: ${current.carbs}g`,
            getMainMenuKeyboard()
        );
        return;
    }

    const parts = afterCommand.split(",").map(p => p.trim());

    if (parts.length < 3) {
        sendTelegramMessage(
            chatId,
            "⚠️ Please provide all three values: `/setgoals Calories,Protein,Carbs`\n\n" +
            "*Example:* `/setgoals 2500,100,320`",
            getMainMenuKeyboard()
        );
        return;
    }

    const calories = Number(parts[0]);
    const protein = Number(parts[1]);
    const carbs = Number(parts[2]);

    if (isNaN(calories) || isNaN(protein) || isNaN(carbs) || calories <= 0 || protein <= 0 || carbs <= 0) {
        sendTelegramMessage(chatId, "⚠️ All goals must be positive numbers.", getMainMenuKeyboard());
        return;
    }

    setGoals(calories, protein, carbs);

    sendTelegramMessage(
        chatId,
        `🎯 *Goals Updated!*\n\n` +
        `• *Calories:* ${calories} kcal\n` +
        `• *Protein:* ${protein}g\n` +
        `• *Carbs:* ${carbs}g`,
        getMainMenuKeyboard()
    );
}

function handleViewGoals(chatId) {
    const goals = getGoals();
    const progress = getDailyProgress();

    sendTelegramMessage(
        chatId,
        `🎯 *Your Daily Goals*\n\n` +
        `• *Calories:* ${goals.calories} kcal\n` +
        `• *Protein:* ${goals.protein}g\n` +
        `• *Carbs:* ${goals.carbs}g\n\n` +
        formatDailyProgress(progress) + `\n\n` +
        `_Use_ \`/setgoals Cal,Prot,Carbs\` _to change._`,
        getMainMenuKeyboard()
    );
}

// ──────────────────────────────────────────────
//  UX: REAL-TIME DAILY PROGRESS TRACKING
// ──────────────────────────────────────────────

/**
 * Calculates today's total macros.
 * Reads pre-computed values from the 'Dashboard' sheet (B1:B4),
 * which uses native SUMIFS formulas — O(1) instead of iterating Logs.
 */
function getDailyProgress() {
    const dashboard = getSheet('Dashboard');
    if (!dashboard) return { calories: 0, protein: 0, carbs: 0, fats: 0 };

    const vals = dashboard.getRange('B1:B4').getValues();
    return {
        calories: Number(vals[0][0]) || 0,
        protein: Number(vals[1][0]) || 0,
        carbs: Number(vals[2][0]) || 0,
        fats: Number(vals[3][0]) || 0
    };
}

function formatDailyProgress(progress) {
    const goals = getGoals();

    const calRemaining = goals.calories - progress.calories;
    const protRemaining = goals.protein - progress.protein;
    const carbRemaining = goals.carbs - progress.carbs;

    const calStatus = calRemaining > 0 ? `${calRemaining} left` : '✅';
    const protStatus = protRemaining > 0 ? `${protRemaining}g left` : '✅';
    const carbStatus = carbRemaining > 0 ? `${carbRemaining}g left` : '✅';

    return `📈 *Today's Progress:*\n` +
        `• *Calories:* ${progress.calories} / ${goals.calories} kcal (${calStatus})\n` +
        `• *Protein:* ${progress.protein}g / ${goals.protein}g (${protStatus})\n` +
        `• *Carbs:* ${progress.carbs}g / ${goals.carbs}g (${carbStatus})\n` +
        `• *Fats:* ${progress.fats}g`;
}

// ──────────────────────────────────────────────
//  WEIGHT LOGGING & 7-DAY MOVING AVERAGE
// ──────────────────────────────────────────────
function handleWeightLogging(chatId, text) {
    const parts = text.split(/\s+/);
    const weightNum = parseFloat(parts[1]);

    if (isNaN(weightNum) || weightNum <= 0) {
        sendTelegramMessage(chatId, "⚠️ Invalid weight format. Please use: `/weight 68.5`", getMainMenuKeyboard());
        return;
    }

    let weightSheet = getSheet('Weight');

    if (!weightSheet) {
        weightSheet = getSS().insertSheet('Weight');
        weightSheet.appendRow(['Date', 'Weight (kg)', '7-Day Moving Avg (kg)']);
        _sheets['Weight'] = weightSheet;
    }

    const now = new Date();
    const timeZone = Session.getScriptTimeZone();
    const dateStr = Utilities.formatDate(now, timeZone, "yyyy-MM-dd");

    const data = weightSheet.getDataRange().getValues();
    let sum = weightNum;
    let count = 1;

    for (let i = data.length - 1; i >= 1 && count < 7; i--) {
        const val = parseFloat(data[i][1]);
        if (!isNaN(val)) {
            sum += val;
            count++;
        }
    }
    const movingAvg = (sum / count).toFixed(2);

    weightSheet.appendRow([dateStr, weightNum, movingAvg]);

    sendTelegramMessage(
        chatId,
        `⚖️ *Scale Weight Logged!*\n\n` +
        `• *Today's Weight:* ${weightNum} kg\n` +
        `• *7-Day Average:* ${movingAvg} kg`,
        getMainMenuKeyboard()
    );
}

// ──────────────────────────────────────────────
//  EVENING PROTEIN NUDGE
// ──────────────────────────────────────────────
function sendEveningProteinNudge() {
    const chatId = PropertiesService.getScriptProperties().getProperty('ALLOWED_CHAT_ID');
    if (!chatId) return;

    const progress = getDailyProgress();
    const todayProtein = progress.protein;

    const goals = getGoals();
    if (todayProtein < goals.protein) {
        const diff = goals.protein - todayProtein;
        const msg = `⚠️ *Protein Alert!*\n\n` +
            `You are currently at *${todayProtein}g / ${goals.protein}g* protein today.\n` +
            `You need *${diff}g* more to hit your lean bulk target. Consider having a post-workout shake or high-protein snack!`;

        sendTelegramMessage(chatId, msg, getMainMenuKeyboard());
    }
}

// ──────────────────────────────────────────────
//  UNDO LAST LOG
// ──────────────────────────────────────────────
function undoLastLog(chatId) {
    const logsSheet = getSheet('Logs');
    if (!logsSheet) return;

    const lastRow = logsSheet.getLastRow();
    if (lastRow <= 1) {
        sendTelegramMessage(chatId, "⚠️ No entries to undo!", getMainMenuKeyboard());
        return;
    }

    const rowData = logsSheet.getRange(lastRow, 1, 1, 8).getValues()[0];
    const foodItem = rowData[3] || "Last entry";

    logsSheet.deleteRow(lastRow);

    sendTelegramMessage(chatId, `🗑️ *Deleted:* "${foodItem}" has been removed from your logs.`, getMainMenuKeyboard());
}

// ──────────────────────────────────────────────
//  PRESET CHECK
// ──────────────────────────────────────────────
function checkPreset(input) {
    const presets = getPresetsData();
    const normalized = input.toLowerCase();

    for (const p of presets) {
        if (p.shortcut === normalized) {
            return {
                itemName: p.itemName,
                calories: p.calories,
                protein: p.protein,
                carbs: p.carbs,
                fats: p.fats
            };
        }
    }
    return null;
}

// ──────────────────────────────────────────────
//  DYNAMIC MODEL DISCOVERY
// ──────────────────────────────────────────────
function getActiveModels() {
    // Tried in order; a model that fails is skipped (and rested for a while).
    // Free tier limits are very different per model. The lite models allow
    // ~500 requests/day and 15/min, the full flash models only ~20/day and 5/min,
    // so the lite models go first and the full models are kept as backups.
    // Check https://ai.google.dev/gemini-api/docs/deprecations periodically.
    return [
        "gemini-3.5-flash-lite",
        "gemini-3.1-flash-lite",
        "gemini-3.6-flash",
        "gemini-3.8-flash"
    ];
}

// A model that returned quota or not found errors is skipped for a while so
// we do not waste a request (and a slow round trip) on it for every message.
const MODEL_COOLDOWN_SECONDS = { 429: 300, 404: 21600, 403: 21600 };
const GEMINI_TIME_BUDGET_MS = 35000;   // stop trying more models after this long

// ──────────────────────────────────────────────
//  GEMINI MACRO EXTRACTION (TEXT)
// ──────────────────────────────────────────────
function getGeminiMacros(input) {
    const payload = {
        contents: [{ parts: [{ text: `Estimate macros for this food entry: "${input}"` }] }],
        systemInstruction: {
            parts: [{
                text: `You are a precision nutrition assistant for a lean bulk diet tracker.\n\nCRITICAL PRIORITY RULES — follow in this exact order:\n1. NUTRITIONAL LABEL DETECTED: Extract EXACT numbers. Do not guess.\n2. PLATED FOOD: Estimate portions with SEA/Singapore context.\n3. TEXT-ONLY: Estimate based on typical SEA portion sizes.\n\nReturn ONLY a valid JSON object. Do not include markdown formatting.`
            }]
        },
        safetySettings: [
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" }
        ],
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
                type: "OBJECT",
                properties: {
                    foodItem: { type: "STRING" },
                    calories: { type: "NUMBER" },
                    protein: { type: "NUMBER" },
                    carbs: { type: "NUMBER" },
                    fats: { type: "NUMBER" }
                },
                required: ["foodItem", "calories", "protein", "carbs", "fats"]
            }
        }
    };

    const payloadString = JSON.stringify(payload);
    const modelsToTry = getActiveModels();
    const cache = CacheService.getScriptCache();
    const startedAt = Date.now();
    const failures = [];   // e.g. ["gemini-3.8-flash: 503", "gemini-2.5-flash: 404"]

    // Loop through the live list of models
    for (const modelName of modelsToTry) {
        // Skip models that recently hit quota / not found
        const restingCode = cache.get('MODEL_COOLDOWN_' + modelName);
        if (restingCode) {
            failures.push(`${modelName}: ${restingCode}`);
            continue;
        }

        // Do not let several slow models add up to minutes of waiting
        if (Date.now() - startedAt > GEMINI_TIME_BUDGET_MS) {
            failures.push(`${modelName}: skipped, out of time`);
            break;
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;

        const options = {
            method: 'post',
            contentType: 'application/json',
            payload: payloadString,
            muteHttpExceptions: true
        };

        const t0 = Date.now();
        const response = UrlFetchApp.fetch(url, options);
        const resData = JSON.parse(response.getContentText());
        console.log(`Gemini ${modelName} responded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

        if (resData.error) {
            // 429 = Quota Exceeded, 403 = Billing/Restricted
            // Now gracefully skips to the next model instead of throwing a fatal error
            if ([503, 404, 429, 403].includes(resData.error.code)) {
                console.warn(`Model ${modelName} failed (${resData.error.code}): ${resData.error.message}. Trying next...`);
                failures.push(`${modelName}: ${resData.error.code}`);
                const rest = MODEL_COOLDOWN_SECONDS[resData.error.code];
                if (rest) {
                    try { cache.put('MODEL_COOLDOWN_' + modelName, String(resData.error.code), rest); } catch (e) { }
                }
                continue;
            } else {
                throw new Error(`Gemini API Error ${resData.error.code}: ${resData.error.message}`);
            }
        }

        // --- SUCCESS ---
        if (resData.candidates && resData.candidates.length > 0) {
            if (resData.candidates[0].finishReason !== "STOP") {
                console.error("Generation stopped early. Reason:", resData.candidates[0].finishReason);
                return null;
            }

            let rawString = resData.candidates[0].content.parts[0].text || "";
            rawString = rawString.replace(/```json/gi, '').replace(/```/g, '').trim();

            try {
                const parsed = JSON.parse(rawString);
                return {
                    foodItem: parsed.foodItem || "Unknown Item",
                    calories: Number(parsed.calories) || 0,
                    protein: Number(parsed.protein) || 0,
                    carbs: Number(parsed.carbs) || 0,
                    fats: Number(parsed.fats) || 0
                };
            } catch (err) {
                console.error("JSON Parsing failed on string:", rawString);
                return null;
            }
        }
        return null;
    }

    // Every model failed. Only report "overloaded" (which triggers the cooldown)
    // when the failures were really 503s; otherwise show the real codes.
    if (failures.length > 0) {
        const allOverloaded = failures.every(f => f.endsWith(': 503'));
        if (allOverloaded) {
            throw new Error(`All models are currently overloaded (503). Please try again in a few minutes.`);
        }
        throw new Error(`All Gemini models failed - ${failures.join(', ')}`);
    }

    return null;
}

// ──────────────────────────────────────────────
//  SHEET LOGGING
// ──────────────────────────────────────────────
function logToSheet(rawInput, foodItem, calories, protein, carbs = 0, fats = 0) {
    const sheet = getSheet('Logs');
    const now = new Date();
    const timeZone = Session.getScriptTimeZone();

    const dateStr = Utilities.formatDate(now, timeZone, "yyyy-MM-dd");
    const timeStr = Utilities.formatDate(now, timeZone, "HH:mm");

    sheet.appendRow([dateStr, timeStr, rawInput, foodItem, calories, protein, carbs, fats]);
}

// ──────────────────────────────────────────────
//  DAILY & WEEKLY SUMMARY
// ──────────────────────────────────────────────
function sendSummaryMessage(chatId) {
    const summarySheet = getSheet('Weekly Summary');

    const timeZone = Session.getScriptTimeZone();
    const todayStr = Utilities.formatDate(new Date(), timeZone, "yyyy-MM-dd");

    // Daily totals from Dashboard sheet (pre-computed by SUMIFS formulas)
    const progress = getDailyProgress();
    const todayCals = progress.calories;
    const todayProtein = progress.protein;
    const todayCarbs = progress.carbs;
    const todayFats = progress.fats;

    const goals = getGoals();

    let totalBudget = goals.calories * 7;
    let weekConsumed = 0;
    let rolloverIn = 0;

    if (summarySheet && summarySheet.getLastRow() > 1) {
        const thisMonday = getMonday(new Date(), timeZone);
        const thisMondayStr = Utilities.formatDate(thisMonday, timeZone, "yyyy-MM-dd");
        const summaryData = summarySheet.getDataRange().getValues();

        for (let i = summaryData.length - 1; i >= 1; i--) {
            const rowDate = Utilities.formatDate(new Date(summaryData[i][0]), timeZone, "yyyy-MM-dd");
            if (rowDate === thisMondayStr) {
                totalBudget = Number(summaryData[i][3]) || totalBudget;
                weekConsumed = Number(summaryData[i][4]) || 0;
                rolloverIn = Number(summaryData[i][2]) || 0;
                break;
            }
        }
    }

    const remainingBudget = totalBudget - weekConsumed;

    let msg = `📊 *Daily & Weekly Summary* (${todayStr})\n\n` +
        `*Calories:* ${todayCals} / ${goals.calories} kcal\n` +
        `*Protein:* ${todayProtein}g / ${goals.protein}g\n` +
        `*Carbs:* ${todayCarbs}g / ${goals.carbs}g | *Fats:* ${todayFats}g\n\n`;

    if (rolloverIn > 0) {
        msg += `*Weekly Budget:* ${remainingBudget} / ${totalBudget} kcal left\n` +
            `_(includes ${rolloverIn} kcal rollover)_`;
    } else {
        msg += `*Weekly Budget:* ${remainingBudget} / ${totalBudget} kcal left`;
    }

    sendTelegramMessage(chatId, msg, getMainMenuKeyboard());
}

// ──────────────────────────────────────────────
//  HELP & KEYBOARD
// ──────────────────────────────────────────────
function getHelpMessage() {
    return `👋 *Macro Tracker Bot*\n\n` +
        `• Text any meal to auto-log macros.\n` +
        `• 🧠 Repeated foods are logged from memory for consistency.\n` +
        `• Type \`/weight 68.5\` to log your scale weight.\n` +
        `• Type \`/addpreset shortcut,Name,Cal,P,C,F\` to create a preset.\n` +
        `• Type \`/setgoals Cal,Prot,Carbs\` to set daily targets.\n` +
        `• Tap \`↩️ Undo Last\` to remove the last entry.\n` +
        `• Tap \`📊 View Summary\` for today's breakdown.\n` +
        `• Tap \`🎯 Goals\` to view/manage your targets.\n\n` +
        `_Weekly calorie rollover is automated every Monday._`;
}

function getMainMenuKeyboard() {
    // Row 1: Core actions
    const keyboard = [
        [{ text: "📊 View Summary" }, { text: "↩️ Undo Last" }],
        [{ text: "🎯 Goals" }, { text: "🏠 Main Menu" }]
    ];

    // Dynamic preset buttons — served from cache, not raw sheet read
    try {
        const presets = getPresetsData();

        if (presets.length > 0) {
            const presetButtons = presets.map(p => ({ text: p.shortcutDisplay }));

            for (let i = 0; i < presetButtons.length; i += 2) {
                const row = [presetButtons[i]];
                if (i + 1 < presetButtons.length) {
                    row.push(presetButtons[i + 1]);
                }
                keyboard.splice(keyboard.length - 1, 0, row);
            }
        }
    } catch (err) {
        console.error("Error loading presets for keyboard: ", err);
    }

    return {
        keyboard: keyboard,
        resize_keyboard: true,
        is_persistent: true
    };
}

// ──────────────────────────────────────────────
//  TELEGRAM MESSAGING
// ──────────────────────────────────────────────
function sendTelegramMessage(chatId, text, replyMarkup, inlineMarkup) {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    const payload = {
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown'
    };

    // Inline keyboard takes priority — the persistent keyboard stays active
    // from the last message that set it, so it remains visible.
    if (inlineMarkup) {
        payload.reply_markup = inlineMarkup;
    } else if (replyMarkup) {
        payload.reply_markup = replyMarkup;
    }

    UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload)
    });
}

function editTelegramMessage(chatId, messageId, newText) {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageText`;
    UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({
            chat_id: chatId,
            message_id: messageId,
            text: newText,
            parse_mode: 'Markdown'
        })
    });
}

function editTelegramMessageRemoveInline(chatId, messageId) {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageReplyMarkup`;
    UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [] }
        })
    });
}
