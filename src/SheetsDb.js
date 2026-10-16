/**
 * Google Sheets access.
 *
 * Each doPost runs in a fresh V8 isolate, so these variables only live for one
 * request. They make sure we pay for each Sheets lookup once per execution.
 */

let _ss = null;
let _sheets = {};

/** Returns the active spreadsheet, cached for the lifetime of this execution. */
function getSS() {
    if (!_ss) _ss = SpreadsheetApp.getActiveSpreadsheet();
    return _ss;
}

/** Returns a sheet by name (or null), cached for the lifetime of this execution. */
function getSheet(name) {
    if (!(name in _sheets)) _sheets[name] = getSS().getSheetByName(name);
    return _sheets[name];
}

/**
 * Returns the sheet with this name, creating it with a header row when missing.
 * @param {string} name
 * @param {string[]} headers  header row written when the sheet is created
 * @param {boolean} [hidden]  hide the sheet when it is created
 */
function getOrCreateSheet(name, headers, hidden) {
    let sheet = getSheet(name);
    if (!sheet) {
        sheet = getSS().insertSheet(name);
        sheet.appendRow(headers);
        if (hidden) sheet.hideSheet();
        _sheets[name] = sheet;
    }
    return sheet;
}

/**
 * Short unique id for a log entry. It starts with a letter so Sheets never
 * reads it as a number (which could drop leading zeros or turn it into 1e5).
 */
function generateEntryId_() {
    return 'k' + Utilities.getUuid().replace(/-/g, '').substring(0, 9);
}

/**
 * Appends one food entry to the Logs sheet.
 * @returns {string} the new entry's id, used by the undo button
 */
function logToSheet(rawInput, foodItem, calories, protein, carbs = 0, fats = 0) {
    const sheet = getSheet(SHEET.LOGS);
    const now = new Date();
    const timeZone = Session.getScriptTimeZone();

    const dateStr = formatYmd(now, timeZone);
    const timeStr = Utilities.formatDate(now, timeZone, 'HH:mm');
    const entryId = generateEntryId_();

    sheet.appendRow([dateStr, timeStr, rawInput, foodItem, calories, protein, carbs, fats, entryId]);
    return entryId;
}

/**
 * Finds the row of a log entry by its id, or -1 when it is gone.
 * Uses a server side search, so it does not read the whole sheet.
 */
function findLogRowById_(entryId) {
    const sheet = getSheet(SHEET.LOGS);
    if (!sheet || !entryId) return -1;

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return -1;

    const found = sheet.getRange(2, LOG_COL.ENTRY_ID, lastRow - 1, 1)
        .createTextFinder(entryId)
        .matchEntireCell(true)
        .matchCase(true)
        .findNext();
    return found ? found.getRow() : -1;
}

/**
 * Everything the bot needs from the Dashboard sheet in one read.
 *
 * Dashboard column B holds formulas, so the sheet does the adding up
 *   B1 to B4  today's calories, protein, carbs, fats
 *   B5        start (Monday) of this week
 *   B6        this week's total budget
 *   B7        this week's rollover in
 *   B8        calories eaten so far this week
 */
function getDashboardSnapshot() {
    const snapshot = {
        calories: 0, protein: 0, carbs: 0, fats: 0,
        weekTotalBudget: 0, weekRolloverIn: 0, weekConsumed: 0
    };

    const dashboard = getSheet(SHEET.DASHBOARD);
    if (!dashboard) return snapshot;

    const vals = dashboard.getRange('B1:B8').getValues();
    const num = i => Number(vals[i][0]) || 0;

    snapshot.calories = num(0);
    snapshot.protein = num(1);
    snapshot.carbs = num(2);
    snapshot.fats = num(3);
    snapshot.weekTotalBudget = num(5);
    snapshot.weekRolloverIn = num(6);
    snapshot.weekConsumed = num(7);
    return snapshot;
}

/** Today's total macros, taken from the Dashboard sheet. */
function getDailyProgress() {
    const s = getDashboardSnapshot();
    return { calories: s.calories, protein: s.protein, carbs: s.carbs, fats: s.fats };
}
