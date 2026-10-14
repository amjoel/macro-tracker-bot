/** Daily calorie, protein and carb goals (stored in Script Properties). */

const DEFAULT_GOALS = { calories: 2300, protein: 80, carbs: 300 };

function getGoals() {
    const props = PropertiesService.getScriptProperties();
    return {
        calories: Number(props.getProperty('GOAL_CALORIES')) || DEFAULT_GOALS.calories,
        protein: Number(props.getProperty('GOAL_PROTEIN')) || DEFAULT_GOALS.protein,
        carbs: Number(props.getProperty('GOAL_CARBS')) || DEFAULT_GOALS.carbs
    };
}

function setGoals(calories, protein, carbs) {
    const props = PropertiesService.getScriptProperties();
    props.setProperty('GOAL_CALORIES', calories.toString());
    props.setProperty('GOAL_PROTEIN', protein.toString());
    props.setProperty('GOAL_CARBS', carbs.toString());
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
