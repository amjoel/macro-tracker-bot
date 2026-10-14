/** Date helpers used by the weekly budget and logging code. */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Formats a date as yyyy-MM-dd in the given time zone. */
function formatYmd(date, timeZone) {
    return Utilities.formatDate(date, timeZone, 'yyyy-MM-dd');
}

/** Returns the Monday (00:00) of the week containing the given date. */
function getMonday(date, timeZone) {
    const d = new Date(date);
    const dayStr = Utilities.formatDate(d, timeZone, 'u'); // 1=Mon, 7=Sun
    const dayOfWeek = parseInt(dayStr, 10);
    const diff = dayOfWeek - 1;
    const monday = new Date(d.getTime() - diff * MS_PER_DAY);
    const mondayStr = formatYmd(monday, timeZone);
    return new Date(mondayStr + 'T00:00:00');
}
