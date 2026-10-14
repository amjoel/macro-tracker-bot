/**
 * Presets, one-tap shortcuts that log fixed macros without calling Gemini.
 *
 * Reads go through the same three layers as the macro cache
 * (request variable, CacheService, then the Presets sheet).
 */

const PRESETS_CACHE_KEY = 'PRESETS_DATA';
const PRESETS_HEADERS = ['Shortcut Key', 'Item Name', 'Calories', 'Protein', 'Carbs', 'Fat'];

let _presetsData = null;  // L0

/** Returns all presets as an array of objects. */
function getPresetsData() {
    if (_presetsData !== null) return _presetsData;

    const cache = CacheService.getScriptCache();
    const cached = cache.get(PRESETS_CACHE_KEY);
    if (cached) {
        _presetsData = JSON.parse(cached);
        return _presetsData;
    }

    const sheet = getSheet(SHEET.PRESETS);
    if (!sheet || sheet.getLastRow() <= 1) {
        _presetsData = [];
        return _presetsData;
    }

    const data = sheet.getDataRange().getValues();
    const presets = [];
    for (let i = 1; i < data.length; i++) {
        const shortcut = String(data[i][0]).trim();
        if (shortcut) {
            presets.push({
                shortcut: shortcut.toLowerCase(),
                shortcutDisplay: shortcut,
                itemName: data[i][1],
                calories: Number(data[i][2]) || 0,
                protein: Number(data[i][3]) || 0,
                carbs: Number(data[i][4]) || 0,
                fats: Number(data[i][5]) || 0
            });
        }
    }

    _presetsData = presets;
    try { cache.put(PRESETS_CACHE_KEY, JSON.stringify(presets), CACHE_TTL_SHORT); } catch (e) { /* cache full, degrade gracefully */ }
    return _presetsData;
}

/** Clears presets from both CacheService and request-scoped memory. */
function invalidatePresetsCache() {
    _presetsData = null;
    try { CacheService.getScriptCache().remove(PRESETS_CACHE_KEY); } catch (e) { }
}

/** Returns the macros for a preset whose shortcut matches the text, or null. */
function checkPreset(input) {
    const normalized = input.toLowerCase();

    for (const p of getPresetsData()) {
        if (p.shortcut === normalized) {
            return {
                foodItem: p.itemName,
                calories: p.calories,
                protein: p.protein,
                carbs: p.carbs,
                fats: p.fats
            };
        }
    }
    return null;
}

/** Handles /addpreset shortcut,Item Name,Calories,Protein,Carbs,Fats */
function handleAddPreset(chatId, text) {
    const afterCommand = text.replace(/^\/addpreset\s*/i, '').trim();

    if (!afterCommand) {
        sendTelegramMessage(
            chatId,
            'ℹ️ *Usage:*\n`/addpreset shortcut,Item Name,Calories,Protein,Carbs,Fats`\n\n' +
            '*Example:*\n`/addpreset morning oats,Oatmeal with Banana,350,12,55,8`',
            getMainMenuKeyboard()
        );
        return;
    }

    const parts = afterCommand.split(',').map(p => p.trim());

    if (parts.length < 4) {
        sendTelegramMessage(
            chatId,
            '⚠️ Not enough values. Need at least: `shortcut,Item Name,Calories,Protein`\n\n' +
            'Full format: `/addpreset shortcut,Item Name,Calories,Protein,Carbs,Fats`',
            getMainMenuKeyboard()
        );
        return;
    }

    const shortcut = parts[0];
    const itemName = parts[1];
    const calories = Number(parts[2]) || 0;
    const protein = Number(parts[3]) || 0;
    const carbs = parts.length > 4 ? (Number(parts[4]) || 0) : 0;
    const fats = parts.length > 5 ? (Number(parts[5]) || 0) : 0;

    if (!shortcut || !itemName) {
        sendTelegramMessage(chatId, '⚠️ Shortcut key and Item Name cannot be empty.', getMainMenuKeyboard());
        return;
    }

    const presetSheet = getOrCreateSheet(SHEET.PRESETS, PRESETS_HEADERS);
    presetSheet.appendRow([shortcut, itemName, calories, protein, carbs, fats]);

    // Invalidate so getMainMenuKeyboard() picks up the new preset
    invalidatePresetsCache();

    sendTelegramMessage(
        chatId,
        `✅ *Preset Added!*\n\n` +
        `🔑 *Shortcut:* \`${shortcut}\`\n` +
        `🍽 *Item:* ${itemName}\n` +
        `🔥 *Calories:* ${calories} kcal\n` +
        `💪 *Protein:* ${protein}g | *Carbs:* ${carbs}g | *Fat:* ${fats}g\n\n` +
        `Just type \`${shortcut}\` to log it instantly!`,
        getMainMenuKeyboard()
    );
}
