/**
 * Decides what to do with an incoming text message.
 *
 * The handlers are wrapped in arrow functions on purpose. Apps Script files
 * are loaded one after another, so a handler defined in a later file does not
 * exist yet when this table is built. The wrapper looks it up when it is called.
 */

const COMMAND_ROUTES = [
    {
        matches: t => t === '/start' || t === '/help' || t === '🏠 Main Menu',
        run: chatId => sendTelegramMessage(chatId, getHelpMessage(), getMainMenuKeyboard())
    },
    {
        matches: t => t === '/summary' || t === '📊 View Summary',
        run: chatId => {
            ensureCurrentWeekRow();
            sendSummaryMessage(chatId);
        }
    },
    {
        matches: t => t === '/undo' || t === '↩️ Undo Last',
        run: chatId => undoLastLog(chatId)
    },
    {
        matches: t => /^(\/weight|weight )/i.test(t),
        run: (chatId, text) => handleWeightLogging(chatId, text)
    },
    {
        matches: t => /^\/addpreset/i.test(t),
        run: (chatId, text) => handleAddPreset(chatId, text)
    },
    {
        matches: t => /^\/savepreset/i.test(t),
        run: (chatId, text) => handleSavePresetCommand(chatId, text)
    },
    {
        matches: t => /^\/setgoals/i.test(t),
        run: (chatId, text) => handleSetGoals(chatId, text)
    },
    {
        matches: t => t === '/goals' || t === '🎯 Goals',
        run: chatId => handleViewGoals(chatId)
    }
];

/** Sends a message from the authorized chat to the right handler. */
function routeMessage(chatId, message) {
    // Text only for now. Photo logging is not supported yet
    if (!message.text) {
        if (message.photo && message.photo.length > 0) {
            sendTelegramMessage(chatId, "📸 Photo logging isn't available yet. Please type what you ate instead.", getMainMenuKeyboard());
        }
        return;
    }

    const rawText = message.text.trim();

    // A reply to "name this preset" is a shortcut name, not a meal
    if (handlePresetPromptReply(chatId, message, rawText)) return;

    const route = findCommandRoute(rawText);
    if (route) {
        route.run(chatId, rawText);
        return;
    }

    // Anything else is treated as a meal description
    handleFoodEntry(chatId, rawText);
}

/** Returns the command route that handles this text, or null. */
function findCommandRoute(text) {
    return COMMAND_ROUTES.find(r => r.matches(text)) || null;
}

/** Sends a tap on an inline button to the right handler. */
function handleCallbackQuery(callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    const data = callbackQuery.data || '';

    if (!isAuthorized(chatId)) {
        answerCallbackQuery(callbackQuery.id, '🚫 Unauthorized.');
        return;
    }

    if (data.startsWith(UNDO_CALLBACK_PREFIX)) {
        undoEntryById_(callbackQuery, chatId, messageId, data.substring(UNDO_CALLBACK_PREFIX.length));
    } else if (data.startsWith(SAVE_PRESET_CALLBACK_PREFIX)) {
        handleSavePresetButton(callbackQuery, chatId, messageId, data.substring(SAVE_PRESET_CALLBACK_PREFIX.length));
    }
}
