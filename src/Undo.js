/** Undo for log entries, via the menu button and the inline button. */

const UNDO_CALLBACK_PREFIX = 'undo_id_';

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

/**
 * Handles taps on the inline "Undo This Entry" button.
 *
 * The button carries the entry's id, not its row number. Row numbers shift
 * whenever an earlier row is deleted or inserted, so an id always finds the
 * right entry, including after you edit the sheet by hand.
 */
function handleCallbackQuery(callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    const data = callbackQuery.data;

    if (!isAuthorized(chatId)) {
        answerCallbackQuery(callbackQuery.id, '🚫 Unauthorized.');
        return;
    }

    if (data && data.startsWith(UNDO_CALLBACK_PREFIX)) {
        undoEntryById_(callbackQuery, chatId, messageId, data.substring(UNDO_CALLBACK_PREFIX.length));
    }
}

function undoEntryById_(callbackQuery, chatId, messageId, entryId) {
    const row = findLogRowById_(entryId);

    if (row < 2) {
        answerCallbackQuery(callbackQuery.id, '⚠️ Entry already removed.');
        editTelegramMessageRemoveInline(chatId, messageId);
        return;
    }

    const logsSheet = getSheet(SHEET.LOGS);
    const rowData = logsSheet.getRange(row, 1, 1, LOG_COL.FATS).getValues()[0];
    const foodItem = rowData[LOG_COL.FOOD_ITEM - 1] || 'Entry';

    logsSheet.deleteRow(row);

    editTelegramMessage(
        chatId,
        messageId,
        `🗑️ *Undone:* "${foodItem}" has been removed from your logs.`
    );
    answerCallbackQuery(callbackQuery.id, `🗑️ "${foodItem}" removed!`);
}
