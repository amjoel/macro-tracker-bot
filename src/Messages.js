/** Text builders for the messages the bot sends. */

function getHelpMessage() {
    return `👋 *Macro Tracker Bot*\n\n` +
        `• Text any meal to auto-log macros.\n` +
        `• 🧠 Repeated foods are logged from memory for consistency.\n` +
        `• Type \`/weight 68.5\` to log your scale weight.\n` +
        `• Type \`/addpreset shortcut,Name,Cal,P,C,F\` to create a preset.\n` +
        `• Type \`/setgoals Cal,Prot,Carbs\` to set daily targets.\n` +
        `• Tap \`↩️ Undo Last\` to remove the last entry.\n` +
        `• Tap \`📊 View Summary\` for today's breakdown.\n` +
        `• Tap \`🎯 Goals\` to view/manage your targets.\n\n` +
        `_Weekly calorie rollover is automated every Monday._`;
}

/** "Today's Progress" block with what is left against each goal. */
function formatDailyProgress(progress) {
    const goals = getGoals();

    const calRemaining = goals.calories - progress.calories;
    const protRemaining = goals.protein - progress.protein;
    const carbRemaining = goals.carbs - progress.carbs;

    const calStatus = calRemaining > 0 ? `${calRemaining} left` : '✅';
    const protStatus = protRemaining > 0 ? `${protRemaining}g left` : '✅';
    const carbStatus = carbRemaining > 0 ? `${carbRemaining}g left` : '✅';

    return `📈 *Today's Progress:*\n` +
        `• *Calories:* ${progress.calories} / ${goals.calories} kcal (${calStatus})\n` +
        `• *Protein:* ${progress.protein}g / ${goals.protein}g (${protStatus})\n` +
        `• *Carbs:* ${progress.carbs}g / ${goals.carbs}g (${carbStatus})\n` +
        `• *Fats:* ${progress.fats}g`;
}

/** Reply sent after a food entry is logged. */
function formatLoggedMessage(header, macros, progress) {
    return `${header}\n\n` +
        `🍽 *Item:* ${macros.foodItem}\n` +
        `🔥 *Calories:* ${macros.calories} kcal\n` +
        `💪 *Protein:* ${macros.protein}g | *Carbs:* ${macros.carbs}g | *Fat:* ${macros.fats}g\n\n` +
        formatDailyProgress(progress);
}
