# Telegram Macro Tracker Bot

A private Telegram bot that logs meals and tracks daily and weekly macros in Google Sheets. Send a text description of what you ate, and the bot estimates calories, protein, carbs and fats using the Gemini API, then replies with your progress for the day.

Built with Google Apps Script. No servers to run.

```
Telegram  ->  Apps Script web app (doPost)  ->  Google Sheets
                       |
                       +--> Gemini API
```

## Features

- **Natural language logging.** Text any meal and macros are estimated by Gemini.
- **Consistent repeat entries.** Previously seen text inputs are answered from a "Macro Cache" sheet, so the same meal always logs the same numbers and costs no API call.
- **Presets.** `/addpreset shortcut,Name,Cal,P,C,F` creates one-tap shortcuts that appear on the bot keyboard.
- **Editable goals.** `/setgoals Cal,Protein,Carbs` and a live "left today" progress readout.
- **Weekly calorie budget.** A weekly summary row is created automatically. Unspent calories roll over into the next week.
- **Weight tracking.** `/weight 68.5` logs scale weight with a 7-day moving average.
- **Undo.** An inline "Undo This Entry" button on every log, plus an "Undo Last" menu action.
- **Evening protein nudge.** A time-driven trigger warns you if you are behind on protein.
- **Private by design.** Only one whitelisted Telegram chat ID can use the bot.

## Design notes

- **Layered caching.** Sheet I/O is the slowest part of an Apps Script request, so presets, remembered foods and a weekly-row flag are served from `CacheService` where possible. Each remembered food has its own cache key, so there is no single large value that could pass the 100 KB limit as the history grows. On a miss the sheet is searched on the server side with a `TextFinder`, not read in full.
- **The sheet does the maths.** Totals are formulas, not script loops. `Dashboard` adds up today's macros and looks up this week's budget, and `Weekly Summary` columns D to F are formulas over `Logs`. After logging a meal the bot reads one small range from `Dashboard`, so the cost of a reply does not grow with the size of your history.
- **Stable undo.** Every log row has an `Entry ID`, and the undo button carries that id instead of a row number, so it still finds the right entry after rows above it are deleted or you edit the sheet by hand. Rows you add by hand can leave the id blank.
- **Model fallback.** Gemini requests try several models in order and skip to the next on quota or availability errors (404, 403, 429, 503). Lite models go first because the free tier allows far more requests per day for them. A model that hits quota is rested for a few minutes, and the whole attempt has a time limit.
- **Structured output.** Gemini is called with a JSON response schema so replies parse reliably.
- **Duplicate update protection.** Telegram can resend an update, so each `update_id` is remembered in `CacheService` and ignored the second time. `doPost` also returns nothing instead of `ContentService` output, because Apps Script answers that with a 302 redirect, which Telegram treats as a failed delivery.

## Roadmap

- Photo logging for food and nutrition labels (removed for now while it is reworked)

## Google Sheet layout

The script expects these tabs in the bound spreadsheet. `setupSheets()` creates all of them with their headers and formulas (see Setup).

| Sheet | Purpose |
| --- | --- |
| `Logs` | One row per entry: date, time, raw input, food item, calories, protein, carbs, fats, entry id |
| `Dashboard` | Formulas. `B1:B4` today's calories, protein, carbs, fats. `B5:B9` this week's start, total budget, rollover in, consumed and budget left |
| `Presets` | Shortcut key, item name, calories, protein, carbs, fat |
| `Macro Cache` | Normalised input to macros (hidden, auto-created) |
| `Weekly Summary` | Week start, base target, rollover in (written by the bot), then total budget, consumed and deficit as formulas |
| `Weight` | Date, weight, and a formula for the average of the last 7 days by date (auto-created) |
| `Settings` | Your daily calorie, protein and carb goals. Edit here or with `/setgoals` |
| `Daily` | Formulas only. One row per day from your first log to today, with totals, goals, whether protein was met, and 7-day averages. The bot never reads it |

## Setup from scratch

You need a Google account, a Telegram account, and a Gemini API key. Everything runs on free tiers.

1. **Create the spreadsheet.** Make a new Google Sheet. Under **File > Settings**, set the time zone to yours, because the `Dashboard` formulas use `TODAY()`. Also set `timeZone` in `src/appsscript.json` to the same zone.
2. **Create the Apps Script project bound to it.** Open **Extensions > Apps Script**, then copy the project's script ID from **Project Settings**.
3. **Upload the code with clasp.**
   ```bash
   npm install -g @google/clasp
   clasp login
   cp .clasp.json.example .clasp.json     # put your script ID in it (rootDir is src)
   clasp push
   ```
   You will be asked to enable the Apps Script API at https://script.google.com/home/usersettings the first time.
4. **Set up the sheets.** In the Apps Script editor, pick `setupSheets` in the function dropdown and click **Run**, then approve the permissions. It creates every tab, header and formula described above, with default goals of 2300 kcal, 80g protein and 300g carbs. Change them in the `Settings` sheet.
5. **Create the bot.** Message [@BotFather](https://t.me/BotFather), send `/newbot`, and copy the token. Send any message to your new bot, then open `https://api.telegram.org/bot<TOKEN>/getUpdates` to find your chat id.
6. **Get a Gemini API key** from [Google AI Studio](https://aistudio.google.com/).
7. **Add the secrets.** In Apps Script, go to **Project Settings > Script Properties** and add:

   | Property | Value |
   | --- | --- |
   | `TELEGRAM_TOKEN` | Bot token from BotFather |
   | `GEMINI_API_KEY` | Gemini API key |
   | `ALLOWED_CHAT_ID` | Your Telegram chat id (the only user allowed) |

   The secrets are only read from Script Properties at runtime. They are never stored in this repository.
8. **Deploy as a web app.** Choose **Deploy > New deployment > Web app**, execute as yourself, access for anyone, and copy the `/exec` URL. Access has to be open for Telegram to reach it, and the chat id whitelist is what keeps the bot private.
9. **Point Telegram at it.**
   ```
   https://api.telegram.org/bot<TOKEN>/setWebhook?url=<EXEC_URL>
   ```
10. **Add the time-driven triggers** under **Triggers** in the Apps Script editor:
    - `runWeeklyRollover`, weekly, every Monday
    - `sendEveningProteinNudge`, daily, in the evening

Send your bot `/start` to check it works.

## Making changes

```bash
clasp push                                   # upload code to Apps Script
clasp redeploy <deploymentId> -d "message"   # make the live web app use it
clasp logs                                   # view execution logs
```

`clasp push` updates the working copy only. The Telegram webhook calls a versioned deployment, so run `clasp redeploy` to publish a change. Never make `doPost` return `ContentService` output (see Design notes).

`Debug.js` has helpers to run from the editor: `debugGemini` lists the models your key can use and times each one, `debugWebhookInfo` shows what Telegram thinks of your webhook, and `debugResetWebhook` clears queued updates and registers the webhook again.

## Project structure

```
src/
  Main.js          doPost webhook entry point, duplicate update check, error reporting
  Router.js        Maps a text message to a command handler or to food logging
  FoodLogging.js   Preset, then macro cache, then Gemini, then log and reply
  Gemini.js        Model fallback, rate limit cooldowns, response parsing
  MacroCache.js    Three layer cache so the same text always gives the same macros
  Presets.js       Saved shortcuts and /addpreset
  Goals.js         Daily goals and /setgoals
  Weight.js        /weight and the moving average
  Weekly.js        Weekly budget rollover and the summary message
  SetupSheets.js   setupSheets, creates every tab, header and formula
  Undo.js          Undo last entry and the inline undo button
  Telegram.js      Bot API calls and keyboards
  Messages.js      Text builders for replies
  SheetsDb.js      Sheet access helpers and the Logs and Dashboard readers
  Dates.js         Date helpers
  Config.js        Secrets, sheet names, cache lifetimes, chat whitelist
  Triggers.js      Entry points for time-driven triggers
  Debug.js         Troubleshooting helpers to run from the Apps Script editor
  appsscript.json  Apps Script manifest (runtime, timezone, web app access)
```

Apps Script has no imports, so every file shares one global scope and functions call each other directly. Top level code only builds constants. Anything that needs another file runs inside a function, so file load order does not matter.

## Tech

Google Apps Script (V8), Telegram Bot API, Google Gemini API, Google Sheets, clasp.
