/**
 * Scale weight logging with a 7 day average.
 *
 * Weight columns: A Date, B Weight (kg), C 7-Day Moving Avg (kg).
 * The bot writes A and B. Column C is a formula that averages every weigh-in
 * from the 7 days up to and including that row's date (that day and the 6
 * before it), so the average means the same thing however often you weigh in.
 */

const WEIGHT_HEADERS = ['Date', 'Weight (kg)', '7-Day Moving Avg (kg)'];

/** Formula for column C of the Weight row at this sheet row. */
function weightAverageFormula_(row) {
    return `=ROUND(AVERAGEIFS($B$2:$B,$A$2:$A,">="&A${row}-6,$A$2:$A,"<="&A${row}),2)`;
}

/** Handles /weight 68.5 */
function handleWeightLogging(chatId, text) {
    const parts = text.split(/\s+/);
    const weightNum = parseFloat(parts[1]);

    if (isNaN(weightNum) || weightNum <= 0) {
        sendTelegramMessage(chatId, '⚠️ Invalid weight format. Please use: `/weight 68.5`', getMainMenuKeyboard());
        return;
    }

    const weightSheet = getOrCreateSheet(SHEET.WEIGHT, WEIGHT_HEADERS);

    const timeZone = Session.getScriptTimeZone();
    const dateStr = formatYmd(new Date(), timeZone);

    weightSheet.appendRow([dateStr, weightNum]);
    const row = weightSheet.getLastRow();
    weightSheet.getRange(row, 3).setFormula(weightAverageFormula_(row));

    // Let the sheet work out the average, then read it back
    SpreadsheetApp.flush();
    const average = Number(weightSheet.getRange(row, 3).getValue());
    const movingAvg = (isNaN(average) ? weightNum : average).toFixed(2);

    sendTelegramMessage(
        chatId,
        `⚖️ *Scale Weight Logged!*\n\n` +
        `• *Today's Weight:* ${weightNum} kg\n` +
        `• *7-Day Average:* ${movingAvg} kg`,
        getMainMenuKeyboard()
    );
}
