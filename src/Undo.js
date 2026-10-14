/** Undo for log entries, via the menu button and the inline button. */

/** Removes the most recent log entry ("Undo Last" button or /undo). */
function undoLastLog(chatId) {
    const logsSheet = getSheet(SHEET.LOGS);
    if (!logsSheet) return;

    const lastRow = logsSheet.getLastRow();
    if (lastRow <= 1) {
        sendTelegramMessage(chatId, '⚠️ No entries to undo!', getMainMenuKeyboard());
        return;
    }

    const rowData = logsSheet.getRange(lastRow, 1, 1, 8).getValues()[0];
    const foodItem = rowData[3] || 'Last entry';

    logsSheet.deleteRow(lastRow);

    sendTelegramMessage(chatId, `🗑️ *Deleted:* "${foodItem}" has been removed from your logs.`, getMainMenuKeyboard());
}

/** Handles taps on the inline "Undo This Entry" button. */
function handleCallbackQuery(callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    const data = callbackQuery.data;

    if (!isAuthorized(chatId)) {
        answerCallbackQuery(callbackQuery.id, '🚫 Unauthorized.');
        return;
    }

    if (data && data.startsWith('undo_row_')) {
        const rowNum = parseInt(data.replace('undo_row_', ''), 10);
        if (isNaN(rowNum) || rowNum <= 1) {
            answerCallbackQuery(callbackQuery.id, '⚠️ Invalid undo target.');
            return;
        }

        const logsSheet = getSheet(SHEET.LOGS);

        if (!logsSheet || rowNum > logsSheet.getLastRow()) {
            answerCallbackQuery(callbackQuery.id, '⚠️ Entry already removed.');
            editTelegramMessageRemoveInline(chatId, messageId);
            return;
        }

        const rowData = logsSheet.getRange(rowNum, 1, 1, 8).getValues()[0];
        const foodItem = rowData[3] || 'Entry';

        logsSheet.deleteRow(rowNum);

        editTelegramMessage(
            chatId,
            messageId,
            `🗑️ *Undone:* "${foodItem}" has been removed from your logs.`
        );
        answerCallbackQuery(callbackQuery.id, `🗑️ "${foodItem}" removed!`);
    }
}
