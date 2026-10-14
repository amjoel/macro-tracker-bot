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

- **Layered caching.** Reads go through a request-scoped variable, then `CacheService`, then the sheet. Sheet I/O is the slowest part of an Apps Script request, so presets, the macro cache and a weekly-row flag are served from `CacheService` where possible.
- **Single-read updates.** The Logs sheet is read once per message and shared between the weekly total update and the daily progress.
- **Sheet-side aggregation.** Today's totals are read from a `Dashboard` sheet that uses `SUMIFS` formulas, instead of looping over every log row in script.
- **Model fallback.** Gemini requests try several models in order and skip to the next on quota or availability errors (404, 403, 429, 503). Lite models go first because the free tier allows far more requests per day for them. A model that hits quota is rested for a few minutes, and the whole attempt has a time limit.
- **Structured output.** Gemini is called with a JSON response schema so replies parse reliably.
- **Duplicate update protection.** Telegram can resend an update, so each `update_id` is remembered in `CacheService` and ignored the second time. `doPost` also returns nothing instead of `ContentService` output, because Apps Script answers that with a 302 redirect, which Telegram treats as a failed delivery.

## Roadmap

- Photo logging for food and nutrition labels (removed for now while it is reworked)

## Google Sheet layout

The script expects these tabs in the bound spreadsheet. Some are created automatically on first use.

| Sheet | Purpose |
| --- | --- |
| `Logs` | One row per entry: date, time, raw input, food item, calories, protein, carbs, fats |
| `Dashboard` | `B1:B4` hold today's calories, protein, carbs, fats (via `SUMIFS` over `Logs`) |
| `Presets` | Shortcut key, item name, calories, protein, carbs, fat |
| `Macro Cache` | Normalised input to macros (hidden, auto-created) |
| `Weekly Summary` | Week start, base target, rollover in, total budget, consumed, deficit (auto-created) |
| `Weight` | Date, weight, 7-day moving average (auto-created) |

## Setup

1. Create a Google Sheet and open **Extensions > Apps Script**, or create a standalone project and bind it to the sheet.
2. Create a bot with [@BotFather](https://t.me/BotFather) and copy the token.
3. Get a Gemini API key from [Google AI Studio](https://aistudio.google.com/).
4. In Apps Script, go to **Project Settings > Script Properties** and add:

   | Property | Value |
   | --- | --- |
   | `TELEGRAM_TOKEN` | Bot token from BotFather |
   | `GEMINI_API_KEY` | Gemini API key |
   | `ALLOWED_CHAT_ID` | Your Telegram chat ID (the only user allowed) |

   Optional: `GOAL_CALORIES`, `GOAL_PROTEIN`, `GOAL_CARBS` (set from chat with `/setgoals`).
5. Deploy as a **Web app** (execute as you, access: anyone) and copy the `/exec` URL.
6. Point Telegram at it:
   ```
   https://api.telegram.org/bot<TOKEN>/setWebhook?url=<EXEC_URL>
   ```
7. Add time-driven triggers:
   - `runWeeklyRollover` every Monday
   - `sendEveningProteinNudge` every evening

Secrets are only ever read from Script Properties at runtime. They are not stored in this repository.

## Local development with clasp

```bash
npm install -g @google/clasp
clasp login
cp .clasp.json.example .clasp.json   # then fill in your scriptId
clasp push                           # upload code to Apps Script
clasp redeploy <deploymentId> -d "message"   # make the live web app use it
clasp logs                           # view execution logs
```

`clasp push` updates the working copy only. The Telegram webhook calls a versioned deployment, so run `clasp redeploy` to publish a change.

## Project structure

```
Code.js           All bot logic (webhook handler, Gemini, Sheets, caching)
Debug.js          Helpers to run from the Apps Script editor (Gemini and webhook checks)
appsscript.json   Apps Script manifest (runtime, timezone, web app access)
```

## Tech

Google Apps Script (V8), Telegram Bot API, Google Gemini API, Google Sheets, clasp.
