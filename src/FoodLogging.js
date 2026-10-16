/**
 * Logging a food entry.
 *
 * Order of lookup, cheapest first
 *   1. a saved preset
 *   2. the macro cache ("logged from memory")
 *   3. Gemini
 */

const REPLY_HEADERS = {
    PRESET: '⚡ *Preset Logged!*',
    MEMORY: '🧠 *Logged from memory!*',
    GEMINI: '✅ *Logged successfully!*'
};

function handleFoodEntry(chatId, rawText) {
    ensureCurrentWeekRow();

    const preset = checkPreset(rawText);
    if (preset) {
        logAndReply(chatId, rawText, preset, REPLY_HEADERS.PRESET);
        return;
    }

    const remembered = checkMacroCache(rawText);
    if (remembered) {
        logAndReply(chatId, rawText, remembered, REPLY_HEADERS.MEMORY);
        return;
    }

    // Presets and remembered foods never reach Gemini, so only block this step
    if (isGeminiCoolingDown()) {
        console.log('Gemini lookup blocked by overload cooldown');
        sendTelegramMessage(chatId, '⏳ *Gemini AI is currently overloaded.* Please wait a few minutes before trying again.', getMainMenuKeyboard());
        return;
    }

    const macros = getGeminiMacros(rawText);
    if (!macros) {
        sendTelegramMessage(chatId, '⚠️ Could not parse macros. Please try again.', getMainMenuKeyboard());
        return;
    }

    writeMacroCache(rawText, macros);
    logAndReply(chatId, rawText, macros, REPLY_HEADERS.GEMINI);
}

/**
 * Writes the entry to the Logs sheet, updates the weekly total, and replies
 * with today's progress and an undo button.
 * @param {{foodItem:string, calories:number, protein:number, carbs:number, fats:number}} macros
 */
function logAndReply(chatId, rawText, macros, header) {
    const entryId = logToSheet(rawText, macros.foodItem, macros.calories, macros.protein, macros.carbs, macros.fats);

    // The Dashboard and Weekly Summary totals are sheet formulas, so make sure
    // the new row is counted before reading them
    SpreadsheetApp.flush();
    const progress = getDailyProgress();

    sendTelegramMessage(
        chatId,
        formatLoggedMessage(header, macros, progress),
        getMainMenuKeyboard(),
        getUndoInlineKeyboard(entryId)
    );
}
