/**
 * Daily calorie, protein and carb goals.
 *
 * The goals live in the Settings sheet so the sheet formulas (the Daily sheet)
 * and the bot always use the same numbers. You can edit them there by hand or
 * with /setgoals.
 */

const DEFAULT_GOALS = { calories: 2300, protein: 80, carbs: 300 };
const GOALS_CACHE_KEY = 'GOALS';
const CACHE_TTL_GOALS = 120;   // short, so a goal edited by hand shows up within 2 minutes

let _goals = null;   // request-scoped

function getGoals() {
    if (_goals) return _goals;

    const cache = CacheService.getScriptCache();
    const cached = cache.get(GOALS_CACHE_KEY);
    if (cached) {
        _goals = JSON.parse(cached);
        return _goals;
    }

    _goals = readGoals_();
    try { cache.put(GOALS_CACHE_KEY, JSON.stringify(_goals), CACHE_TTL_GOALS); } catch (e) { }
    return _goals;
}

/** Reads the Settings sheet. A missing or blank value falls back to the default. */
function readGoals_() {
    const sheet = getSheet(SHEET.SETTINGS);
    if (!sheet) return Object.assign({}, DEFAULT_GOALS);

    const vals = sheet.getRange(SETTINGS_ROW.CALORIES, 2, 3, 1).getValues();
    return {
        calories: Number(vals[0][0]) || DEFAULT_GOALS.calories,
        protein: Number(vals[1][0]) || DEFAULT_GOALS.protein,
        carbs: Number(vals[2][0]) || DEFAULT_GOALS.carbs
    };
}

function setGoals(calories, protein, carbs) {
    if (!getSheet(SHEET.SETTINGS)) ensureSettings_();

    getSheet(SHEET.SETTINGS)
        .getRange(SETTINGS_ROW.CALORIES, 2, 3, 1)
        .setValues([[calories], [protein], [carbs]]);

    _goals = null;
    try { CacheService.getScriptCache().remove(GOALS_CACHE_KEY); } catch (e) { }
}

/** Handles /setgoals Calories,Protein,Carbs */
function handleSetGoals(chatId, text) {
    const afterCommand = text.replace(/^\/setgoals\s*/i, '').trim();

    if (!afterCommand) {
        const current = getGoals();
        sendTelegramMessage(
            chatId,
            'ℹ️ *Set Your Daily Goals*\n\n' +
            '*Format:* `/setgoals Calories,Protein,Carbs`\n' +
            '*Example:* `/setgoals 2500,100,320`\n\n' +
            `*Current Goals:*\n` +
            `• Calories: ${current.calories} kcal\n` +
            `• Protein: ${current.protein}g\n` +
            `• Carbs: ${current.carbs}g`,
            getMainMenuKeyboard()
        );
        return;
    }

    const parts = afterCommand.split(',').map(p => p.trim());

    if (parts.length < 3) {
        sendTelegramMessage(
            chatId,
            '⚠️ Please provide all three values: `/setgoals Calories,Protein,Carbs`\n\n' +
            '*Example:* `/setgoals 2500,100,320`',
            getMainMenuKeyboard()
        );
        return;
    }

    const calories = Number(parts[0]);
    const protein = Number(parts[1]);
    const carbs = Number(parts[2]);

    if (isNaN(calories) || isNaN(protein) || isNaN(carbs) || calories <= 0 || protein <= 0 || carbs <= 0) {
        sendTelegramMessage(chatId, '⚠️ All goals must be positive numbers.', getMainMenuKeyboard());
        return;
    }

    setGoals(calories, protein, carbs);

    sendTelegramMessage(
        chatId,
        `🎯 *Goals Updated!*\n\n` +
        `• *Calories:* ${calories} kcal\n` +
        `• *Protein:* ${protein}g\n` +
        `• *Carbs:* ${carbs}g`,
        getMainMenuKeyboard()
    );
}

function handleViewGoals(chatId) {
    const goals = getGoals();
    const progress = getDailyProgress();

    sendTelegramMessage(
        chatId,
        `🎯 *Your Daily Goals*\n\n` +
        `• *Calories:* ${goals.calories} kcal\n` +
        `• *Protein:* ${goals.protein}g\n` +
        `• *Carbs:* ${goals.carbs}g\n\n` +
        formatDailyProgress(progress) + `\n\n` +
        `_Use_ \`/setgoals Cal,Prot,Carbs\` _to change._`,
        getMainMenuKeyboard()
    );
}
