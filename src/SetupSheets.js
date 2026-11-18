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
 *
 * Rows 10 to 14 work out today's adjusted targets: what is left of the week's
 * base target (rollover excluded), split over the days left including today.
 * They only count what was eaten before today, so the targets stay the same
 * all day and eating today shows up as "left", not as a lower target.
 * Calories never go below the Settings minimum, and protein never goes below
 * the protein goal (extra protein early in the week doesn't lower later days).
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
    ['This Week Budget Left', '=B6-B8'],
    ['This Week Base Target', "=SUMIFS('Weekly Summary'!$B:$B,'Weekly Summary'!$A:$A,$B$5)"],
    ['This Week Protein', '=SUMIFS(Logs!$F:$F,Logs!$A:$A,">="&$B$5,Logs!$A:$A,"<"&$B$5+7)'],
    ['Days Left (incl. Today)', '=7-WEEKDAY(TODAY(),3)'],
    ["Today's Calorie Target", '=MAX(Settings!$B$5,ROUND((IF(B10>0,B10,Settings!$B$2*7)-(B8-B1))/B12))'],
    ["Today's Protein Target", '=MAX(Settings!$B$3,ROUND((Settings!$B$3*7-(B11-B2))/B12))']
];

/**
 * Daily sheet goal columns, the same adjusted targets as the Dashboard but
 * worked out for every past day. Older versions used the plain Settings goal,
 * and setupSheets swaps those for these.
 */
const DAILY_CALORIE_GOAL_FORMULA = `=MAP($A$2:$A,LAMBDA(d,IF(d="",,LET(m,d-WEEKDAY(d,3),` +
    `base,SUMIFS('Weekly Summary'!$B:$B,'Weekly Summary'!$A:$A,m),` +
    `before,SUMIFS(Logs!$E:$E,Logs!$A:$A,">="&m,Logs!$A:$A,"<"&d),` +
    `MAX(Settings!$B$5,ROUND((IF(base>0,base,Settings!$B$2*7)-before)/(7-WEEKDAY(d,3))))))))`;
const DAILY_PROTEIN_GOAL_FORMULA = `=MAP($A$2:$A,LAMBDA(d,IF(d="",,LET(m,d-WEEKDAY(d,3),` +
    `before,SUMIFS(Logs!$F:$F,Logs!$A:$A,">="&m,Logs!$A:$A,"<"&d),` +
    `MAX(Settings!$B$3,ROUND((Settings!$B$3*7-before)/(7-WEEKDAY(d,3))))))))`;
const OLD_DAILY_GOAL_FORMULAS = {
    F: '=ARRAYFORMULA(IF($A$2:$A="",,Settings!$B$2))',
    G: '=ARRAYFORMULA(IF($A$2:$A="",,Settings!$B$3))'
};

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

/**
 * Creates the Settings sheet with the default goals. In an existing one, only
 * a missing minimum calories row is added. Your values are never changed.
 */
function ensureSettings_() {
    let sheet = getSheet(SHEET.SETTINGS);
    if (!sheet) {
        sheet = getSS().insertSheet(SHEET.SETTINGS);
        _sheets[SHEET.SETTINGS] = sheet;

        sheet.getRange(1, 1, 4, 3).setValues([
            ['Setting', 'Value', 'Notes'],
            ['Daily Calories (kcal)', DEFAULT_GOALS.calories, 'Used by the bot and the Daily sheet. Edit here or with /setgoals.'],
            ['Daily Protein (g)', DEFAULT_GOALS.protein, 'Also the minimum for the adjusted daily protein target.'],
            ['Daily Carbs (g)', DEFAULT_GOALS.carbs, '']
        ]);
        sheet.setFrozenRows(1);
    }

    const minRow = sheet.getRange(SETTINGS_ROW.MIN_CALORIES, 1, 1, 3);
    if (minRow.getValues()[0].every(v => String(v).trim() === '')) {
        minRow.setValues([['Min Daily Calories (kcal)', DEFAULT_GOALS.minCalories,
            'The adjusted daily calorie target never goes below this, even after eating more earlier in the week.']]);
    }
}

/**
 * Daily sheet, one row per calendar day from your first log to today.
 * Everything is a formula, row 2 of each column fills the rest of the column,
 * and the bot never reads or writes this sheet, so it costs nothing at runtime.
 * The goal columns hold each day's adjusted target, worked out from the
 * current Settings goals.
 *
 * The per day totals use MAP. SUMIFS inside ARRAYFORMULA does not step through
 * an array of criteria, it reuses the first one for every row.
 */
function ensureDaily_() {
    if (getSheet(SHEET.DAILY)) {
        upgradeDailyGoalColumns_(getSheet(SHEET.DAILY));
        return;
    }

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
        DAILY_CALORIE_GOAL_FORMULA,
        DAILY_PROTEIN_GOAL_FORMULA,
        `=ARRAYFORMULA(IF(${blank},,$B$2:$B-$F$2:$F))`,
        `=ARRAYFORMULA(IF(${blank},,IF($C$2:$C>=$G$2:$G,"Yes","No")))`,
        rolling('B'),
        rolling('C')
    ];
    formulas.forEach((f, i) => sheet.getRange(2, i + 1).setFormula(f));

    sheet.getRange(2, 1, sheet.getMaxRows() - 1, 1).setNumberFormat('yyyy-mm-dd');
    sheet.getRange(2, 10, sheet.getMaxRows() - 1, 2).setNumberFormat('0');
}

/** Swaps the old fixed goal formulas for the adjusted ones. A formula you changed yourself is left alone. */
function upgradeDailyGoalColumns_(sheet) {
    const upgrades = [['F', 6, DAILY_CALORIE_GOAL_FORMULA], ['G', 7, DAILY_PROTEIN_GOAL_FORMULA]];
    upgrades.forEach(([col, colIndex, formula]) => {
        const cell = sheet.getRange(2, colIndex);
        if (cell.getFormula() === OLD_DAILY_GOAL_FORMULAS[col]) cell.setFormula(formula);
    });
}
