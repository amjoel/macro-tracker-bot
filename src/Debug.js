/**
 * Diagnostic helper. Run `debugGemini` from the Apps Script editor
 * (select it in the function dropdown, click Run, then open Execution log).
 *
 * 1. Lists the models your API key can actually use for generateContent.
 * 2. Pings each model in getActiveModels() and prints HTTP status + a short reply.
 *
 * The API key is never printed.
 */
function debugGemini() {
    const key = GEMINI_API_KEY;
    if (!key) {
        console.log('GEMINI_API_KEY is missing from Script Properties.');
        return;
    }

    // 1. Models available to this key
    const listRes = UrlFetchApp.fetch(
        'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=' + key,
        { muteHttpExceptions: true }
    );
    console.log('List models -> HTTP ' + listRes.getResponseCode());
    try {
        const models = JSON.parse(listRes.getContentText()).models || [];
        const usable = models
            .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
            .map(m => m.name.replace('models/', ''))
            .filter(n => n.indexOf('gemini') === 0);
        console.log('Usable gemini models: ' + usable.join(', '));
    } catch (e) {
        console.log('Could not parse model list: ' + listRes.getContentText().substring(0, 300));
    }

    // 2. Ping each model we try in production
    getActiveModels().forEach(function (modelName) {
        const started = Date.now();
        const res = UrlFetchApp.fetch(
            'https://generativelanguage.googleapis.com/v1beta/models/' + modelName + ':generateContent?key=' + key,
            {
                method: 'post',
                contentType: 'application/json',
                payload: JSON.stringify({ contents: [{ parts: [{ text: 'Reply with the single word: ok' }] }] }),
                muteHttpExceptions: true
            }
        );
        const seconds = ((Date.now() - started) / 1000).toFixed(1);
        console.log(modelName + ' -> HTTP ' + res.getResponseCode() + ' in ' + seconds + 's | ' + res.getContentText().substring(0, 250).replace(/\s+/g, ' '));
    });
}

/**
 * Prints what Telegram currently thinks of your webhook. Run from the editor.
 * Look at pending_update_count and last_error_message.
 * The bot token is never printed.
 */
function debugWebhookInfo() {
    const info = getWebhookInfoRaw_();
    console.log('pending_update_count = ' + info.pending_update_count);
    console.log('last_error_date = ' + (info.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : 'none'));
    console.log('last_error_message = ' + (info.last_error_message || 'none'));
    console.log('max_connections = ' + info.max_connections);
    console.log('webhook url set = ' + (info.url ? 'yes' : 'NO'));
}

/**
 * Throws away every update Telegram has queued up and registers the same
 * webhook URL again. Use this when old messages keep being replayed.
 * Any messages still waiting in the queue are lost, so resend them afterwards.
 */
function debugResetWebhook() {
    const info = getWebhookInfoRaw_();
    if (!info.url) {
        console.log('No webhook URL is set, nothing to reset.');
        return;
    }
    const base = 'https://api.telegram.org/bot' + TELEGRAM_TOKEN;
    const del = UrlFetchApp.fetch(base + '/deleteWebhook?drop_pending_updates=true', { muteHttpExceptions: true });
    console.log('deleteWebhook -> ' + del.getContentText());
    const set = UrlFetchApp.fetch(base + '/setWebhook?url=' + encodeURIComponent(info.url), { muteHttpExceptions: true });
    console.log('setWebhook -> ' + set.getContentText());
}

function getWebhookInfoRaw_() {
    const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/getWebhookInfo', { muteHttpExceptions: true });
    return JSON.parse(res.getContentText()).result || {};
}
