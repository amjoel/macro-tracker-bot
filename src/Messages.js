/** Text builders for the messages the bot sends. */

function getHelpMessage() {
    return `👋 *Macro Tracker Bot*\n\n` +
        `• Text any meal to auto-log macros.\n` +
        `• 🧠 Repeated foods are logged from memory for consistency.\n` +
        `• Type \`/weight 68.5\` to log your scale weight.\n` +
        `• Type \`/addpreset shortcut,Name,Cal,P,C,F\` to create a preset.\n` +
        `• Tap \`⭐ Save as Preset\` under a log, or type \`/savepreset\`, to turn a meal into a preset.\n` +
        `• Type \`/setgoals Cal,Prot,Carbs\` to set daily targets.\n` +
        `• Tap \`↩️ Undo Last\` to remove the last entry.\n` +
        `• Tap \`📊 View Summary\` for today's breakdown.\n` +
        `• Tap \`🎯 Goals\` to view/manage your targets.\n\n` +
        `_Weekly calorie rollover is automated every Monday._`;
}

/**
 * "Today's Progress" block with what is left against today's targets.
 * @param progress from getDailyProgress(), including its targets
 */
function formatDailyProgress(progress) {
    const targets = progress.targets;
    const round1 = n => Math.round(n * 10) / 10;

    const calRemaining = round1(targets.calories - progress.calories);
    const protRemaining = round1(targets.protein - progress.protein);
    const carbRemaining = round1(targets.carbs - progress.carbs);

    const calStatus = calRemaining > 0 ? `${calRemaining} left` : '✅';
    const protStatus = protRemaining > 0 ? `${protRemaining}g left` : '✅';
    const carbStatus = carbRemaining > 0 ? `${carbRemaining}g left` : '✅';

    return `📈 *Today's Progress:*\n` +
        `• *Calories:* ${progress.calories} / ${targets.calories} kcal (${calStatus})\n` +
        `• *Protein:* ${progress.protein}g / ${targets.protein}g (${protStatus})\n` +
        `• *Carbs:* ${progress.carbs}g / ${targets.carbs}g (${carbStatus})\n` +
        `• *Fats:* ${progress.fats}g` +
        formatTargetNote(targets);
}

/** A short note when today's targets differ from the base goals, so the change isn't a surprise. */
function formatTargetNote(targets) {
    const goals = getGoals();
    if (targets.calories === goals.calories && targets.protein === goals.protein) return '';
    return `\n_Targets adjusted for the rest of the week (base ${goals.calories} kcal, ${goals.protein}g protein)._`;
}

/** Reply sent after a food entry is logged. */
function formatLoggedMessage(header, macros, progress) {
    return `${header}\n\n` +
        `🍽 *Item:* ${macros.foodItem}\n` +
        `🔥 *Calories:* ${macros.calories} kcal\n` +
        `💪 *Protein:* ${macros.protein}g | *Carbs:* ${macros.carbs}g | *Fat:* ${macros.fats}g\n\n` +
        formatDailyProgress(progress);
}

/** Reply sent after a preset is created. */
function formatPresetAddedMessage(preset) {
    return `✅ *Preset Added!*\n\n` +
        `🔑 *Shortcut:* \`${preset.shortcut}\`\n` +
        `🍽 *Item:* ${preset.itemName}\n` +
        `🔥 *Calories:* ${preset.calories} kcal\n` +
        `💪 *Protein:* ${preset.protein}g | *Carbs:* ${preset.carbs}g | *Fat:* ${preset.fats}g\n\n` +
        `Tap its button or type \`${preset.shortcut}\` to log it instantly!`;
}
