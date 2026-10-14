/** Scale weight logging with a 7 entry moving average. */

const WEIGHT_HEADERS = ['Date', 'Weight (kg)', '7-Day Moving Avg (kg)'];

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

    // Average of today's weight and up to the 6 most recent earlier entries
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
