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

/** Appends one food entry to the Logs sheet. */
function logToSheet(rawInput, foodItem, calories, protein, carbs = 0, fats = 0) {
    const sheet = getSheet(SHEET.LOGS);
    const now = new Date();
    const timeZone = Session.getScriptTimeZone();

    const dateStr = formatYmd(now, timeZone);
    const timeStr = Utilities.formatDate(now, timeZone, 'HH:mm');

    sheet.appendRow([dateStr, timeStr, rawInput, foodItem, calories, protein, carbs, fats]);
}

/**
 * Today's total macros.
 * Reads values pre-computed by SUMIFS formulas in the Dashboard sheet (B1:B4),
 * which is much cheaper than looping over every log row in script.
 */
function getDailyProgress() {
    const dashboard = getSheet(SHEET.DASHBOARD);
    if (!dashboard) return { calories: 0, protein: 0, carbs: 0, fats: 0 };

    const vals = dashboard.getRange('B1:B4').getValues();
    return {
        calories: Number(vals[0][0]) || 0,
        protein: Number(vals[1][0]) || 0,
        carbs: Number(vals[2][0]) || 0,
        fats: Number(vals[3][0]) || 0
    };
}
