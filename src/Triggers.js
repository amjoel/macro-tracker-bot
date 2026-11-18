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

    // Today's adjusted target, which includes catching up on protein missed earlier this week
    const target = progress.targets.protein;
    if (todayProtein < target) {
        const diff = Math.round((target - todayProtein) * 10) / 10;
        const msg = `⚠️ *Protein Alert!*\n\n` +
            `You are currently at *${todayProtein}g / ${target}g* protein today.\n` +
            `You need *${diff}g* more to hit your lean bulk target. Consider having a post-workout shake or high-protein snack!`;

        sendTelegramMessage(chatId, msg, getMainMenuKeyboard());
    }
}
