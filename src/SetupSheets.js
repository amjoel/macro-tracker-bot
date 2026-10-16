/**
 * One click spreadsheet setup.
 *
 * Run setupSheets() once from the Apps Script editor (pick it in the function
 * dropdown and click Run). It creates every tab, header and formula the bot
 * needs. It only creates what is missing and never overwrites existing data,
 * so it is safe to run again.
 */

const LOGS_HEADERS = ['Date', 'Time', 'Raw Input', 'Food Item', 'Calories (kcal)', 'Protein (g)', 'Carbs (g)', 'Fat (g)', 'Entry ID'];
const DAILY_HEADERS = ['Date', 'Calories', 'Protein (g)', 'Carbs (g)', 'Fats (g)', 'Calorie Goal', 'Protein Goal',
    'Calories vs Goal', 'Protein Goal Met', '7-Day Avg Calories', '7-Day Avg Protein'];

/**
 * Dashboard rows as [label, formula]. Rows 1 to 4 are today's totals,
 * rows 5 to 9 are this week's budget, looked up from Weekly Summary.
 * WEEKDAY(date, 3) counts Monday as 0, so TODAY() minus it is this Monday.
 */
const DASHBOARD_ROWS = [
    ["Today's Calories", '=SUMIFS(Logs!E:E, Logs!A:A, TEXT(TODAY(), "yyyy-mm-dd"))'],
    ["Today's Protein", '=SUMIFS(Logs!F:F, Logs!A:A, TEXT(TODAY(), "yyyy-mm-dd"))'],
    ["Today's Carbs", '=SUMIFS(Logs!G:G, Logs!A:A, TEXT(TODAY(), "yyyy-mm-dd"))'],
    ["Today's Fats", '=SUMIFS(Logs!H:H, Logs!A:A, TEXT(TODAY(), "yyyy-mm-dd"))'],
    ['This Week Starts (Mon)', '=TODAY()-WEEKDAY(TODAY(),3)'],
    ['This Week Total Budget', "=SUMIFS('Weekly Summary'!$D:$D,'Weekly Summary'!$A:$A,$B$5)"],
    ['This Week Rollover In', "=SUMIFS('Weekly Summary'!$C:$C,'Weekly Summary'!$A:$A,$B$5)"],
    ['This Week Consumed', "=SUMIFS('Weekly Summary'!$E:$E,'Weekly Summary'!$A:$A,$B$5)"],
    ['This Week Budget Left', '=B6-B8']
];

/** Creates any tab, header or formula that is missing. */
function setupSheets() {
    getOrCreateSheet(SHEET.LOGS, LOGS_HEADERS);
    getOrCreateSheet(SHEET.PRESETS, PRESETS_HEADERS);
    getOrCreateSheet(SHEET.MACRO_CACHE, MACRO_CACHE_HEADERS, true);
    getOrCreateSheet(SHEET.WEEKLY_SUMMARY, WEEKLY_SUMMARY_HEADERS);
    getOrCreateSheet(SHEET.WEIGHT, WEIGHT_HEADERS);

    ensureDashboard_();
    ensureSettings_();
    ensureDaily_();
}

/** Fills Dashboard rows that are empty. Existing cells are left alone. */
function ensureDashboard_() {
    let dashboard = getSheet(SHEET.DASHBOARD);
    if (!dashboard) {
        dashboard = getSS().insertSheet(SHEET.DASHBOARD);
        _sheets[SHEET.DASHBOARD] = dashboard;
    }

    DASHBOARD_ROWS.forEach(function (entry, i) {
        const row = i + 1;
        const labelCell = dashboard.getRange(row, 1);
        const formulaCell = dashboard.getRange(row, 2);
        if (String(labelCell.getValue()).trim() === '') labelCell.setValue(entry[0]);
        if (formulaCell.getFormula() === '' && String(formulaCell.getValue()).trim() === '') {
            formulaCell.setFormula(entry[1]);
        }
    });
}

/** Creates the Settings sheet with the default goals. An existing one is left as it is. */
function ensureSettings_() {
    if (getSheet(SHEET.SETTINGS)) return;

    const sheet = getSS().insertSheet(SHEET.SETTINGS);
    _sheets[SHEET.SETTINGS] = sheet;

    sheet.getRange(1, 1, 4, 3).setValues([
        ['Setting', 'Value', 'Notes'],
        ['Daily Calories (kcal)', DEFAULT_GOALS.calories, 'Used by the bot and the Daily sheet. Edit here or with /setgoals.'],
        ['Daily Protein (g)', DEFAULT_GOALS.protein, ''],
        ['Daily Carbs (g)', DEFAULT_GOALS.carbs, '']
    ]);
    sheet.setFrozenRows(1);
}

/**
 * Daily sheet, one row per calendar day from your first log to today.
 * Everything is a formula, row 2 of each column fills the rest of the column,
 * and the bot never reads or writes this sheet, so it costs nothing at runtime.
 * It uses today's goals from Settings for every day.
 *
 * The per day totals use MAP. SUMIFS inside ARRAYFORMULA does not step through
 * an array of criteria, it reuses the first one for every row.
 */
function ensureDaily_() {
    if (getSheet(SHEET.DAILY)) return;

    const sheet = getSS().insertSheet(SHEET.DAILY);
    _sheets[SHEET.DAILY] = sheet;

    sheet.getRange(1, 1, 1, DAILY_HEADERS.length).setValues([DAILY_HEADERS]);
    sheet.setFrozenRows(1);

    const blank = '$A$2:$A=""';
    const logsDay = col => `=MAP($A$2:$A,LAMBDA(d,IF(d="",,SUMIFS(Logs!$${col}:$${col},Logs!$A:$A,d))))`;
    const rolling = col => `=MAP($A$2:$A,LAMBDA(d,IF(d="",,AVERAGEIFS($${col}$2:$${col},$A$2:$A,">"&d-7,$A$2:$A,"<="&d))))`;

    const formulas = [
        `=IF(COUNT(Logs!$A$2:$A)=0,,SEQUENCE(MAX(1,TODAY()-INT(MIN(Logs!$A$2:$A))+1),1,INT(MIN(Logs!$A$2:$A))))`,
        logsDay('E'),
        logsDay('F'),
        logsDay('G'),
        logsDay('H'),
        `=ARRAYFORMULA(IF(${blank},,Settings!$B$2))`,
        `=ARRAYFORMULA(IF(${blank},,Settings!$B$3))`,
        `=ARRAYFORMULA(IF(${blank},,$B$2:$B-$F$2:$F))`,
        `=ARRAYFORMULA(IF(${blank},,IF($C$2:$C>=$G$2:$G,"Yes","No")))`,
        rolling('B'),
        rolling('C')
    ];
    formulas.forEach((f, i) => sheet.getRange(2, i + 1).setFormula(f));

    sheet.getRange(2, 1, sheet.getMaxRows() - 1, 1).setNumberFormat('yyyy-mm-dd');
    sheet.getRange(2, 10, sheet.getMaxRows() - 1, 2).setNumberFormat('0');
}
