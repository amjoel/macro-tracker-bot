/**
 * Gemini macro estimation for text entries.
 *
 * Tries several models in order. A model that fails with a skippable error is
 * rested for a while, and the whole attempt has a time limit.
 */

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
const GEMINI_SKIPPABLE_CODES = [503, 404, 429, 403];   // 429 quota, 403 billing, 404 gone, 503 overloaded
const GEMINI_TIME_BUDGET_MS = 35000;                   // stop trying more models after this long

// A model that returned quota or not found errors is skipped for a while so
// we do not waste a slow round trip on it for every message.
const MODEL_COOLDOWN_PREFIX = 'MODEL_COOLDOWN_';
const MODEL_COOLDOWN_SECONDS = { 429: 300, 404: 21600, 403: 21600 };

// After every model reports 503, pause all Gemini calls briefly
const GEMINI_COOLDOWN_KEY = 'GEMINI_503_COOLDOWN';
const GEMINI_COOLDOWN_SECONDS = 180;
const GEMINI_OVERLOADED_CODE = 'GEMINI_OVERLOADED';    // set on the Error thrown when every model is overloaded

/** Models in the order they are tried. */
function getActiveModels() {
    // Free tier limits differ a lot per model. The lite models allow
    // ~500 requests/day and 15/min, the full flash models only ~20/day and 5/min,
    // so the lite models go first and the full models are kept as backups.
    // Check https://ai.google.dev/gemini-api/docs/deprecations periodically.
    return [
        'gemini-3.5-flash-lite',
        'gemini-3.1-flash-lite',
        'gemini-3.6-flash',
        'gemini-3.8-flash'
    ];
}

function isGeminiCoolingDown() {
    return !!CacheService.getScriptCache().get(GEMINI_COOLDOWN_KEY);
}

function startGeminiCooldown() {
    CacheService.getScriptCache().put(GEMINI_COOLDOWN_KEY, '1', GEMINI_COOLDOWN_SECONDS);
}

/**
 * Estimates macros for a food description.
 * @returns {{foodItem:string, calories:number, protein:number, carbs:number, fats:number}|null}
 *          null when Gemini answered but the reply could not be used.
 * @throws when every model failed.
 */
function getGeminiMacros(input) {
    const payloadString = JSON.stringify(buildGeminiPayload_(input));
    const cache = CacheService.getScriptCache();
    const startedAt = Date.now();
    const failures = [];   // e.g. ["gemini-3.6-flash: 503", "gemini-3.8-flash: 429"]

    for (const modelName of getActiveModels()) {
        // Skip models that recently hit quota or were not found
        const restingCode = cache.get(MODEL_COOLDOWN_PREFIX + modelName);
        if (restingCode) {
            failures.push(`${modelName}: ${restingCode}`);
            continue;
        }

        // Do not let several slow models add up to minutes of waiting
        if (Date.now() - startedAt > GEMINI_TIME_BUDGET_MS) {
            failures.push(`${modelName}: skipped, out of time`);
            break;
        }

        const resData = callGeminiModel_(modelName, payloadString);

        if (resData.error) {
            if (!GEMINI_SKIPPABLE_CODES.includes(resData.error.code)) {
                throw new Error(`Gemini API Error ${resData.error.code}: ${resData.error.message}`);
            }

            console.warn(`Model ${modelName} failed (${resData.error.code}): ${resData.error.message}. Trying next...`);
            failures.push(`${modelName}: ${resData.error.code}`);

            const restSeconds = MODEL_COOLDOWN_SECONDS[resData.error.code];
            if (restSeconds) {
                try { cache.put(MODEL_COOLDOWN_PREFIX + modelName, String(resData.error.code), restSeconds); } catch (e) { }
            }
            continue;
        }

        return parseGeminiMacros_(resData);
    }

    // Every model failed
    if (failures.length > 0) throw buildAllModelsFailedError_(failures);
    return null;
}

function buildGeminiPayload_(input) {
    return {
        contents: [{ parts: [{ text: `Estimate macros for this food entry: "${input}"` }] }],
        systemInstruction: {
            parts: [{
                text: 'You are a precision nutrition assistant for a lean bulk diet tracker.\n\n' +
                    'Estimate macros based on typical SEA/Singapore portion sizes.\n\n' +
                    'Return ONLY a valid JSON object. Do not include markdown formatting.'
            }]
        },
        safetySettings: [
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' }
        ],
        generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: {
                type: 'OBJECT',
                properties: {
                    foodItem: { type: 'STRING' },
                    calories: { type: 'NUMBER' },
                    protein: { type: 'NUMBER' },
                    carbs: { type: 'NUMBER' },
                    fats: { type: 'NUMBER' }
                },
                required: ['foodItem', 'calories', 'protein', 'carbs', 'fats']
            }
        }
    };
}

/** Calls one model and returns the parsed JSON response. */
function callGeminiModel_(modelName, payloadString) {
    const url = `${GEMINI_API_BASE}${modelName}:generateContent?key=${GEMINI_API_KEY}`;

    const t0 = Date.now();
    const response = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        payload: payloadString,
        muteHttpExceptions: true
    });
    const resData = JSON.parse(response.getContentText());
    console.log(`Gemini ${modelName} responded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return resData;
}

/** Turns a successful Gemini response into a macros object, or null if unusable. */
function parseGeminiMacros_(resData) {
    if (!resData.candidates || resData.candidates.length === 0) return null;

    const candidate = resData.candidates[0];
    if (candidate.finishReason !== 'STOP') {
        console.error('Generation stopped early. Reason:', candidate.finishReason);
        return null;
    }

    let rawString = candidate.content.parts[0].text || '';
    rawString = rawString.replace(/```json/gi, '').replace(/```/g, '').trim();

    try {
        const parsed = JSON.parse(rawString);
        return {
            foodItem: parsed.foodItem || 'Unknown Item',
            calories: Number(parsed.calories) || 0,
            protein: Number(parsed.protein) || 0,
            carbs: Number(parsed.carbs) || 0,
            fats: Number(parsed.fats) || 0
        };
    } catch (err) {
        console.error('JSON Parsing failed on string:', rawString);
        return null;
    }
}

/**
 * Only reports "overloaded" (which triggers the cooldown) when every failure
 * was a real 503. Otherwise the message lists the actual codes.
 */
function buildAllModelsFailedError_(failures) {
    const allOverloaded = failures.every(f => f.endsWith(': 503'));
    if (allOverloaded) {
        const error = new Error('All models are currently overloaded (503). Please try again in a few minutes.');
        error.code = GEMINI_OVERLOADED_CODE;
        return error;
    }
    return new Error(`All Gemini models failed - ${failures.join(', ')}`);
}
