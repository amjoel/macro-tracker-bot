/**
 * Weekly calorie budget with rollover, and the /summary message.
 *
 * Weekly Summary columns
 *   0 Week Start (Mon)   1 Base Target   2 Rollover In
 *   3 Total Budget       4 Actual Consumed   5 Deficit (Rollover Out)
 */

const WEEKLY_SUMMARY_HEADERS = ['Week Start (Mon)', 'Base Target', 'Rollover In', 'Total Budget', 'Actual Consumed', 'Deficit (Rollover Out)'];
const WEEK_ROW_FLAG_PREFIX = 'WEEK_ROW_';

/**
 * Index of the data row for the week starting on mondayStr, or -1.
 * Row 0 is the header, so a match is always 1 or greater.
 */
function findWeekRowIndex_(data, mondayStr, timeZone, fromEnd) {
    const matches = i => formatYmd(new Date(data[i][0]), timeZone) === mondayStr;

    if (fromEnd) {
        for (let i = data.length - 1; i >= 1; i--) if (matches(i)) return i;
    } else {
        for (let i = 1; i < data.length; i++) if (matches(i)) return i;
    }
    return -1;
}

/**
 * Time-driven trigger entry point, runs every Monday.
 * Finalizes last week's row and creates one for this week.
 */
function runWeeklyRollover() {
    const summarySheet = getOrCreateSheet(SHEET.WEEKLY_SUMMARY, WEEKLY_SUMMARY_HEADERS);
    const timeZone = Session.getScriptTimeZone();

    const thisMonday = getMonday(new Date(), timeZone);
    const thisMondayStr = formatYmd(thisMonday, timeZone);

    const prevMondayStr = formatYmd(new Date(thisMonday.getTime() - 7 * MS_PER_DAY), timeZone);
    const prevSundayStr = formatYmd(new Date(thisMonday.getTime() - MS_PER_DAY), timeZone);

    const weeklyBaseTarget = getGoals().calories * 7;
    const data = summarySheet.getDataRange().getValues();

    // Add up last week's calories from the Logs
    const logsSheet = getSheet(SHEET.LOGS);
    const logsData = logsSheet ? logsSheet.getDataRange().getValues() : [];
    const prevWeekConsumed = sumCaloriesFromData(logsData, prevMondayStr, prevSundayStr, timeZone);

    // Close out last week's row if it exists
    let rolloverOut = 0;
    const prevIdx = findWeekRowIndex_(data, prevMondayStr, timeZone);
    if (prevIdx > 0) {
        const prevTotalBudget = Number(data[prevIdx][3]) || weeklyBaseTarget;
        rolloverOut = prevTotalBudget - prevWeekConsumed;

        // One write for Actual Consumed and Deficit
        summarySheet.getRange(prevIdx + 1, 5, 1, 2).setValues([[prevWeekConsumed, rolloverOut]]);
    } else if (data.length > 1) {
        rolloverOut = Number(data[data.length - 1][5]) || 0;
    }

    // Nothing more to do if this week already has a row
    if (findWeekRowIndex_(data, thisMondayStr, timeZone) > 0) return;

    const rolloverIn = Math.max(rolloverOut, 0);
    const totalBudget = weeklyBaseTarget + rolloverIn;

    summarySheet.appendRow([thisMondayStr, weeklyBaseTarget, rolloverIn, totalBudget, 0, totalBudget]);

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

/**
 * Updates "Actual Consumed" and "Deficit" for the current week.
 * Called after every food log with the Logs data already loaded.
 */
function updateCurrentWeekConsumed(logsData) {
    const summarySheet = getSheet(SHEET.WEEKLY_SUMMARY);
    if (!summarySheet) return;

    const timeZone = Session.getScriptTimeZone();
    const thisMonday = getMonday(new Date(), timeZone);
    const thisMondayStr = formatYmd(thisMonday, timeZone);
    const thisSundayStr = formatYmd(new Date(thisMonday.getTime() + 6 * MS_PER_DAY), timeZone);

    const data = summarySheet.getDataRange().getValues();
    const idx = findWeekRowIndex_(data, thisMondayStr, timeZone);
    if (idx < 0) return;

    const totalBudget = Number(data[idx][3]) || 0;
    const consumed = sumCaloriesFromData(logsData, thisMondayStr, thisSundayStr, timeZone);

    summarySheet.getRange(idx + 1, 5, 1, 2).setValues([[consumed, totalBudget - consumed]]);
}

/** Sums calories from loaded Logs data for a date range (inclusive). */
function sumCaloriesFromData(logsData, startDateStr, endDateStr, timeZone) {
    let total = 0;
    // Logs are chronological, so walk backwards and stop once we are
    // before the start of the range.
    for (let i = logsData.length - 1; i >= 1; i--) {
        const rowDate = formatYmd(new Date(logsData[i][0]), timeZone);
        if (rowDate < startDateStr) break;
        if (rowDate <= endDateStr) {
            total += Number(logsData[i][4]) || 0;
        }
    }
    return total;
}

/** Sends today's totals and the weekly budget left. */
function sendSummaryMessage(chatId) {
    const summarySheet = getSheet(SHEET.WEEKLY_SUMMARY);

    const timeZone = Session.getScriptTimeZone();
    const todayStr = formatYmd(new Date(), timeZone);

    // Daily totals come from the Dashboard sheet (SUMIFS formulas)
    const progress = getDailyProgress();
    const goals = getGoals();

    let totalBudget = goals.calories * 7;
    let weekConsumed = 0;
    let rolloverIn = 0;

    if (summarySheet && summarySheet.getLastRow() > 1) {
        const thisMondayStr = formatYmd(getMonday(new Date(), timeZone), timeZone);
        const summaryData = summarySheet.getDataRange().getValues();

        const idx = findWeekRowIndex_(summaryData, thisMondayStr, timeZone, true);
        if (idx > 0) {
            totalBudget = Number(summaryData[idx][3]) || totalBudget;
            weekConsumed = Number(summaryData[idx][4]) || 0;
            rolloverIn = Number(summaryData[idx][2]) || 0;
        }
    }

    const remainingBudget = totalBudget - weekConsumed;

    let msg = `📊 *Daily & Weekly Summary* (${todayStr})\n\n` +
        `*Calories:* ${progress.calories} / ${goals.calories} kcal\n` +
        `*Protein:* ${progress.protein}g / ${goals.protein}g\n` +
        `*Carbs:* ${progress.carbs}g / ${goals.carbs}g | *Fats:* ${progress.fats}g\n\n`;

    if (rolloverIn > 0) {
        msg += `*Weekly Budget:* ${remainingBudget} / ${totalBudget} kcal left\n` +
            `_(includes ${rolloverIn} kcal rollover)_`;
    } else {
        msg += `*Weekly Budget:* ${remainingBudget} / ${totalBudget} kcal left`;
    }

    sendTelegramMessage(chatId, msg, getMainMenuKeyboard());
}
