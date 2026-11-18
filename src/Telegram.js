/** Telegram Bot API calls and keyboards. */

/** Calls a Telegram Bot API method with a JSON body. */
/** Calls a Telegram Bot API method with a JSON body and returns the parsed response. */
function callTelegram_(method, payload) {
    const response = UrlFetchApp.fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/${method}`, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload)
    });
    try {
        return JSON.parse(response.getContentText());
    } catch (e) {
        return null;
    }
}

/** Sends a message and returns its message id (null if Telegram didn't say). */
function sendTelegramMessage(chatId, text, replyMarkup, inlineMarkup) {
    const payload = {
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown'
    };

    // Inline keyboard takes priority. The persistent keyboard stays active
    // from the last message that set it, so it remains visible.
    if (inlineMarkup) {
        payload.reply_markup = inlineMarkup;
    } else if (replyMarkup) {
        payload.reply_markup = replyMarkup;
    }

    const response = callTelegram_('sendMessage', payload);
    return response && response.result ? response.result.message_id : null;
}

function editTelegramMessage(chatId, messageId, newText) {
    callTelegram_('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: newText,
        parse_mode: 'Markdown'
    });
}

function editTelegramMessageMarkup(chatId, messageId, inlineMarkup) {
    callTelegram_('editMessageReplyMarkup', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: inlineMarkup
    });
}

function editTelegramMessageRemoveInline(chatId, messageId) {
    editTelegramMessageMarkup(chatId, messageId, { inline_keyboard: [] });
}

function answerCallbackQuery(callbackQueryId, text) {
    callTelegram_('answerCallbackQuery', {
        callback_query_id: callbackQueryId,
        text: text,
        show_alert: false
    });
}

// ──────────────────────────────────────────────
//  KEYBOARDS
// ──────────────────────────────────────────────

/** Persistent menu, plus one button per saved preset. */
function getMainMenuKeyboard() {
    const keyboard = [
        [{ text: '📊 View Summary' }, { text: '↩️ Undo Last' }],
        [{ text: '🎯 Goals' }, { text: '🏠 Main Menu' }]
    ];

    // Dynamic preset buttons, served from cache rather than a raw sheet read
    try {
        const presets = getPresetsData();

        if (presets.length > 0) {
            const presetButtons = presets.map(p => ({ text: p.shortcutDisplay }));

            for (let i = 0; i < presetButtons.length; i += 2) {
                const row = [presetButtons[i]];
                if (i + 1 < presetButtons.length) {
                    row.push(presetButtons[i + 1]);
                }
                keyboard.splice(keyboard.length - 1, 0, row);
            }
        }
    } catch (err) {
        console.error('Error loading presets for keyboard: ', err);
    }

    return {
        keyboard: keyboard,
        resize_keyboard: true,
        is_persistent: true
    };
}

/**
 * Inline buttons under a log message: undo, and optionally save as a preset.
 * Both carry the entry's id, never a row number.
 */
function getLogInlineKeyboard(entryId, canSavePreset) {
    const rows = [[{ text: '↩️ Undo This Entry', callback_data: UNDO_CALLBACK_PREFIX + entryId }]];
    if (canSavePreset) {
        rows.push([{ text: '⭐ Save as Preset', callback_data: SAVE_PRESET_CALLBACK_PREFIX + entryId }]);
    }
    return { inline_keyboard: rows };
}
