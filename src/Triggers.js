/**
 * Entry points for time-driven triggers.
 *
 * Triggers look functions up by name, so do not rename these.
 *   runWeeklyRollover        every Monday          (see Weekly.js)
 *   sendEveningProteinNudge  every evening         (below)
 */

function sendEveningProteinNudge() {
    const chatId = PropertiesService.getScriptProperties().getProperty('ALLOWED_CHAT_ID');
    if (!chatId) return;

    const progress = getDailyProgress();
    const todayProtein = progress.protein;

    const goals = getGoals();
    if (todayProtein < goals.protein) {
        const diff = goals.protein - todayProtein;
        const msg = `⚠️ *Protein Alert!*\n\n` +
            `You are currently at *${todayProtein}g / ${goals.protein}g* protein today.\n` +
            `You need *${diff}g* more to hit your lean bulk target. Consider having a post-workout shake or high-protein snack!`;

        sendTelegramMessage(chatId, msg, getMainMenuKeyboard());
    }
}
