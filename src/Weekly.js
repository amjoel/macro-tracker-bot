/**
 * Weekly calorie budget with rollover, and the /summary message.
 *
 * Weekly Summary columns
 *   A Week Start (Mon)   B Base Target   C Rollover In
 *   D Total Budget       E Actual Consumed   F Deficit (Rollover Out)
 *
 * The bot only writes A, B and C when a week starts. D, E and F are formulas
 * (see weeklyRowFormulas_), so the sheet keeps them up to date by itself and
 * the bot never has to read the Logs to work out the week's total.
 */

const WEEKLY_SUMMARY_HEADERS = ['Week Start (Mon)', 'Base Target', 'Rollover In', 'Total Budget', 'Actual Consumed', 'Deficit (Rollover Out)'];
const WEEK_ROW_FLAG_PREFIX = 'WEEK_ROW_';

/**
 * Index of the data row for the week starting on mondayStr, or -1.
 * Row 0 is the header, so a match is always 1 or greater.
 */
function findWeekRowIndex_(data, mondayStr, timeZone) {
    for (let i = 1; i < data.length; i++) {
        if (formatYmd(new Date(data[i][0]), timeZone) === mondayStr) return i;
    }
    return -1;
}

/** Formulas for columns D to F of the Weekly Summary row at this sheet row. */
function weeklyRowFormulas_(row) {
    return [
        `=B${row}+C${row}`,
        `=SUMIFS(Logs!$E:$E,Logs!$A:$A,">="&$A${row},Logs!$A:$A,"<"&$A${row}+7)`,
        `=D${row}-E${row}`
    ];
}

/** Adds a week to the Weekly Summary sheet. */
function appendWeekRow_(summarySheet, mondayStr, baseTarget, rolloverIn) {
    summarySheet.appendRow([mondayStr, baseTarget, rolloverIn]);
    const row = summarySheet.getLastRow();
    summarySheet.getRange(row, 4, 1, 3).setFormulas([weeklyRowFormulas_(row)]);
}

/** What was left over (or overspent) in an earlier week, for the rollover. */
function getPreviousWeekDeficit_(data, prevMondayStr, timeZone) {
    const prevIdx = findWeekRowIndex_(data, prevMondayStr, timeZone);
    if (prevIdx > 0) return Number(data[prevIdx][5]) || 0;
    if (data.length > 1) return Number(data[data.length - 1][5]) || 0;
    return 0;
}

/**
 * Time-driven trigger entry point, runs every Monday.
 * Creates this week's row, carrying over what was left from last week.
 */
function runWeeklyRollover() {
    const summarySheet = getOrCreateSheet(SHEET.WEEKLY_SUMMARY, WEEKLY_SUMMARY_HEADERS);
    const timeZone = Session.getScriptTimeZone();

    const thisMonday = getMonday(new Date(), timeZone);
    const thisMondayStr = formatYmd(thisMonday, timeZone);
    const prevMondayStr = formatYmd(new Date(thisMonday.getTime() - 7 * MS_PER_DAY), timeZone);

    const data = summarySheet.getDataRange().getValues();

    // Nothing to do if this week already has a row
    if (findWeekRowIndex_(data, thisMondayStr, timeZone) > 0) return;

    const weeklyBaseTarget = getGoals().calories * 7;
    const rolloverIn = Math.max(getPreviousWeekDeficit_(data, prevMondayStr, timeZone), 0);

    appendWeekRow_(summarySheet, thisMondayStr, weeklyBaseTarget, rolloverIn);

    // Flag this week as created
    try { CacheService.getScriptCache().put(WEEK_ROW_FLAG_PREFIX + thisMondayStr, '1', CACHE_TTL_SHORT); } catch (e) { }
}

/**
 * Lazily makes sure the current week has a row. Called before food logging.
 * A CacheService flag skips the sheet read on nearly every request.
 */
function ensureCurrentWeekRow() {
    const timeZone = Session.getScriptTimeZone();
    const thisMondayStr = formatYmd(getMonday(new Date(), timeZone), timeZone);

    const cache = CacheService.getScriptCache();
    if (cache.get(WEEK_ROW_FLAG_PREFIX + thisMondayStr)) return;

    const summarySheet = getSheet(SHEET.WEEKLY_SUMMARY);
    if (!summarySheet) {
        runWeeklyRollover();
        return;
    }

    const data = summarySheet.getDataRange().getValues();
    if (findWeekRowIndex_(data, thisMondayStr, timeZone) > 0) {
        // Row exists, so skip this check for the next 10 minutes
        try { cache.put(WEEK_ROW_FLAG_PREFIX + thisMondayStr, '1', CACHE_TTL_SHORT); } catch (e) { }
        return;
    }

    runWeeklyRollover();
}

/** Sends today's totals and the weekly budget left. */
function sendSummaryMessage(chatId) {
    const timeZone = Session.getScriptTimeZone();
    const todayStr = formatYmd(new Date(), timeZone);

    // Today's totals and this week's budget all come from the Dashboard formulas
    const snapshot = getDashboardSnapshot();
    const goals = getGoals();

    const totalBudget = snapshot.weekTotalBudget || goals.calories * 7;
    const remainingBudget = totalBudget - snapshot.weekConsumed;
    const rolloverIn = snapshot.weekRolloverIn;

    let msg = `📊 *Daily & Weekly Summary* (${todayStr})\n\n` +
        `*Calories:* ${snapshot.calories} / ${goals.calories} kcal\n` +
        `*Protein:* ${snapshot.protein}g / ${goals.protein}g\n` +
        `*Carbs:* ${snapshot.carbs}g / ${goals.carbs}g | *Fats:* ${snapshot.fats}g\n\n`;

    if (rolloverIn > 0) {
        msg += `*Weekly Budget:* ${remainingBudget} / ${totalBudget} kcal left\n` +
            `_(includes ${rolloverIn} kcal rollover)_`;
    } else {
        msg += `*Weekly Budget:* ${remainingBudget} / ${totalBudget} kcal left`;
    }

    sendTelegramMessage(chatId, msg, getMainMenuKeyboard());
}
