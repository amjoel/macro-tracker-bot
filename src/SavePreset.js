/**
 * Saving a logged entry as a preset, from the "Save as Preset" button under a
 * log message, or with /savepreset for the latest entry.
 *
 * A preset needs a shortcut name, so the bot asks for one with a forced reply
 * and remembers which entry the question is about, keyed by the question's
 * message id. Only a reply to that question is read as a shortcut, so a meal
 * typed normally is never mistaken for one.
 */

const SAVE_PRESET_CALLBACK_PREFIX = 'save_preset_';
const PRESET_PROMPT_CACHE_PREFIX = 'PRESET_PROMPT_';
const SUGGESTED_SHORTCUT_LENGTH = 25;

/** Handles /savepreset (asks for a name) and /savepreset name, for the latest entry. */
function handleSavePresetCommand(chatId, text) {
    const shortcut = text.replace(/^\/savepreset\s*/i, '').trim();

    const logsSheet = getSheet(SHEET.LOGS);
    const lastRow = logsSheet ? logsSheet.getLastRow() : 0;
    if (lastRow <= 1) {
        sendTelegramMessage(chatId, '⚠️ No entries to save yet. Log a meal first.', getMainMenuKeyboard());
        return;
    }

    const entry = readLogEntry_(lastRow);

    if (shortcut) {
        savePresetFromEntry_(chatId, entry, shortcut, null);
    } else if (entry.entryId) {
        askForShortcut_(chatId, entry, null, null);
    } else {
        // A row typed into the sheet by hand has no id to remember it by
        sendTelegramMessage(chatId, 'ℹ️ Your last entry was added by hand. Name it in one go:\n`/savepreset shortcut`', getMainMenuKeyboard());
    }
}

/** Handles a tap on "Save as Preset" under a log message. */
function handleSavePresetButton(callbackQuery, chatId, messageId, entryId) {
    const row = findLogRowById_(entryId);

    if (row < 2) {
        answerCallbackQuery(callbackQuery.id, '⚠️ That entry was removed.');
        editTelegramMessageRemoveInline(chatId, messageId);
        return;
    }

    answerCallbackQuery(callbackQuery.id, '');
    askForShortcut_(chatId, readLogEntry_(row), messageId, null);
}

/**
 * If the message is a reply to a "name this preset" question, saves the preset
 * and returns true. A command or menu button sent as the reply cancels the
 * question and returns false, so it is handled as usual.
 */
function handlePresetPromptReply(chatId, message, text) {
    const replyTo = message.reply_to_message;
    if (!replyTo) return false;

    const cache = CacheService.getScriptCache();
    const key = PRESET_PROMPT_CACHE_PREFIX + replyTo.message_id;
    const pending = cache.get(key);
    if (!pending) return false;

    cache.remove(key);
    if (text.startsWith('/') || findCommandRoute(text)) return false;

    const { entryId, logMessageId } = JSON.parse(pending);
    const row = findLogRowById_(entryId);
    if (row < 2) {
        sendTelegramMessage(chatId, '⚠️ That entry was removed, so there is nothing to save.', getMainMenuKeyboard());
        return true;
    }

    savePresetFromEntry_(chatId, readLogEntry_(row), text, logMessageId);
    return true;
}

/** Saves the entry as a preset, or explains what is wrong with the shortcut and asks again. */
function savePresetFromEntry_(chatId, entry, shortcut, logMessageId) {
    const problem = getShortcutProblem(shortcut);
    if (problem) {
        if (entry.entryId) {
            askForShortcut_(chatId, entry, logMessageId, problem);
        } else {
            sendTelegramMessage(chatId, `⚠️ ${problem}`, getMainMenuKeyboard());
        }
        return;
    }

    const preset = {
        shortcut: shortcut,
        itemName: entry.foodItem || entry.rawInput,
        calories: entry.calories,
        protein: entry.protein,
        carbs: entry.carbs,
        fats: entry.fats
    };
    addPreset(preset);

    // Leave only the undo button on the log message, so it can't be saved twice
    if (logMessageId) {
        try {
            editTelegramMessageMarkup(chatId, logMessageId, getLogInlineKeyboard(entry.entryId, false));
        } catch (err) {
            console.warn('Could not update the log message buttons: ' + err);
        }
    }

    sendTelegramMessage(chatId, formatPresetAddedMessage(preset), getMainMenuKeyboard());
}

/** Asks for a shortcut name with a forced reply, and remembers which entry it is for. */
function askForShortcut_(chatId, entry, logMessageId, problem) {
    const name = entry.foodItem || entry.rawInput;
    const text =
        (problem ? `⚠️ ${problem}\n\n` : '') +
        `⭐ *Save as preset:* ${name}\n` +
        `🔥 ${entry.calories} kcal | 💪 P ${entry.protein}g | C ${entry.carbs}g | F ${entry.fats}g\n\n` +
        `Reply with a shortcut name. It becomes a button on your keyboard. Ignore this to cancel.`;

    const promptId = sendTelegramMessage(chatId, text, {
        force_reply: true,
        input_field_placeholder: 'e.g. ' + suggestShortcut_(entry)
    });

    if (promptId) {
        CacheService.getScriptCache().put(
            PRESET_PROMPT_CACHE_PREFIX + promptId,
            JSON.stringify({ entryId: entry.entryId, logMessageId: logMessageId }),
            CACHE_TTL_LONG
        );
    }
}

/** What you typed, when it is short enough to make a good button, otherwise the food name. */
function suggestShortcut_(entry) {
    const raw = entry.rawInput.trim().toLowerCase();
    if (raw && raw.length <= SUGGESTED_SHORTCUT_LENGTH) return raw;
    return (entry.foodItem || raw).toLowerCase().substring(0, SUGGESTED_SHORTCUT_LENGTH).trim();
}

/** Reads one Logs row into an object. */
function readLogEntry_(row) {
    const v = getSheet(SHEET.LOGS).getRange(row, 1, 1, LOG_COL.ENTRY_ID).getValues()[0];
    const num = col => Number(v[col - 1]) || 0;
    return {
        entryId: String(v[LOG_COL.ENTRY_ID - 1] || ''),
        rawInput: String(v[LOG_COL.RAW_INPUT - 1] || ''),
        foodItem: String(v[LOG_COL.FOOD_ITEM - 1] || '').trim(),
        calories: num(LOG_COL.CALORIES),
        protein: num(LOG_COL.PROTEIN),
        carbs: num(LOG_COL.CARBS),
        fats: num(LOG_COL.FATS)
    };
}
