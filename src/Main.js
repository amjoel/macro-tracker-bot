/**
 * Webhook entry point for Telegram.
 *
 * doPost only validates the update, drops duplicates, and hands over to the
 * router. It deliberately returns nothing. If doPost returns ContentService
 * output, Apps Script answers Telegram with a 302 redirect, which Telegram
 * counts as a failed delivery and keeps resending the update.
 */
function doPost(e) {
    let chatId = null;

    try {
        const update = parseUpdate_(e);
        if (!update) return;

        if (isResentUpdate_(update)) return;

        if (update.callback_query) {
            handleCallbackQuery(update.callback_query);
            return;
        }

        if (!update.message) return;

        chatId = update.message.chat.id;

        if (!isAuthorized(chatId)) {
            sendTelegramMessage(chatId, '🚫 Unauthorized. This bot is private.');
            return;
        }

        routeMessage(chatId, update.message);

    } catch (err) {
        reportError_(chatId, err);
    }
}

/** Parses the Telegram update from the request, or returns null when empty. */
function parseUpdate_(e) {
    if (!e || !e.postData || !e.postData.contents) return null;

    const update = JSON.parse(e.postData.contents);
    console.log('doPost received update_id=' + update.update_id +
        (update.message && update.message.text ? ' text="' + update.message.text.substring(0, 40) + '"' : '') +
        (update.callback_query ? ' callback' : ''));
    return update;
}

/**
 * Telegram can resend an update, so remember each update_id and ignore it the
 * second time. Remembered for 6 hours, the longest CacheService allows.
 */
function isResentUpdate_(update) {
    if (!update.update_id) return false;

    const cache = CacheService.getScriptCache();
    const updateKey = 'UPDATE_' + update.update_id;

    if (cache.get(updateKey)) {
        console.log('update_id=' + update.update_id + ' is a resend, ignored');
        return true;
    }

    cache.put(updateKey, '1', CACHE_TTL_LONG);
    return false;
}

/** Logs an error and tells the user, at most once per cooldown when Gemini is overloaded. */
function reportError_(chatId, err) {
    console.error('Error processing update: ', err);

    if (err && err.code === GEMINI_OVERLOADED_CODE) {
        if (!isGeminiCoolingDown()) {
            startGeminiCooldown();
            if (chatId) {
                sendTelegramMessage(chatId, '⏳ *Gemini AI is currently overloaded.* Please wait a few minutes before logging again.', getMainMenuKeyboard());
            }
        }
        return;
    }

    if (chatId) {
        const safeMsg = String(err && err.message).replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
        sendTelegramMessage(chatId, `🛠️ *API Error:* ${safeMsg}`, getMainMenuKeyboard());
    }
}
