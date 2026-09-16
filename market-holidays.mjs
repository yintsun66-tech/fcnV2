const TAIPEI_TIME_ZONE = "Asia/Taipei";

const MARKET_RULES = Object.freeze({
  US: Object.freeze({
    label: "美國",
    restriction: "僅日股 FCN 能做。",
  }),
  JP: Object.freeze({
    label: "日本",
    restriction: "日股 FCN 與 PGN 不得承做。",
  }),
  UK: Object.freeze({
    label: "英國",
    restriction: "PGN 詢價與下單須於中午前完成（比照日股 FCN）。",
  }),
});

/*
 * Full-day weekday closures only. Weekend dates and early closes are deliberately omitted.
 * Verified 2026-09-07 against:
 * - NYSE 2026-2027 holidays: https://www.nyse.com/trade/hours-calendars
 * - JPX 2026-2027 holidays: https://www.jpx.co.jp/english/corporate/about-jpx/calendar/
 * - LSE 2026 calendar: https://docs.londonstockexchange.com/sites/default/files/documents/turquoise-calendar-2026_0.pdf
 * - England/Wales 2027 bank holidays (until LSE publishes its 2027 calendar):
 *   https://www.gov.uk/bank-holidays
 */
export const MARKET_HOLIDAYS = Object.freeze({
  US: Object.freeze({
    "2026-01-01": "元旦",
    "2026-01-19": "馬丁路德金恩紀念日",
    "2026-02-16": "華盛頓誕辰紀念日",
    "2026-04-03": "耶穌受難日",
    "2026-05-25": "陣亡將士紀念日",
    "2026-06-19": "六月節國家獨立日",
    "2026-07-03": "美國獨立紀念日（補假）",
    "2026-09-07": "勞動節",
    "2026-11-26": "感恩節",
    "2026-12-25": "聖誕節",
    "2027-01-01": "元旦",
    "2027-01-18": "馬丁路德金恩紀念日",
    "2027-02-15": "華盛頓誕辰紀念日",
    "2027-03-26": "耶穌受難日",
    "2027-05-31": "陣亡將士紀念日",
    "2027-06-18": "六月節國家獨立日（補假）",
    "2027-07-05": "美國獨立紀念日（補假）",
    "2027-09-06": "勞動節",
    "2027-11-25": "感恩節",
    "2027-12-24": "聖誕節（補假）",
  }),
  JP: Object.freeze({
    "2026-01-01": "元日",
    "2026-01-02": "交易所休業日",
    "2026-01-12": "成人日",
    "2026-02-11": "建國紀念日",
    "2026-02-23": "天皇誕生日",
    "2026-03-20": "春分日",
    "2026-04-29": "昭和日",
    "2026-05-04": "綠之日",
    "2026-05-05": "兒童節",
    "2026-05-06": "憲法紀念日補假",
    "2026-07-20": "海之日",
    "2026-08-11": "山之日",
    "2026-09-21": "敬老日",
    "2026-09-22": "國民假日",
    "2026-09-23": "秋分日",
    "2026-10-12": "運動日",
    "2026-11-03": "文化日",
    "2026-11-23": "勤勞感謝日",
    "2026-12-31": "交易所休業日",
    "2027-01-01": "元日",
    "2027-01-11": "成人日",
    "2027-02-11": "建國紀念日",
    "2027-02-23": "天皇誕生日",
    "2027-03-22": "春分日補假",
    "2027-04-29": "昭和日",
    "2027-05-03": "憲法紀念日",
    "2027-05-04": "綠之日",
    "2027-05-05": "兒童節",
    "2027-07-19": "海之日",
    "2027-08-11": "山之日",
    "2027-09-20": "敬老日",
    "2027-09-23": "秋分日",
    "2027-10-11": "運動日",
    "2027-11-03": "文化日",
    "2027-11-23": "勤勞感謝日",
    "2027-12-31": "交易所休業日",
  }),
  UK: Object.freeze({
    "2026-01-01": "元旦",
    "2026-04-03": "耶穌受難日",
    "2026-04-06": "復活節星期一",
    "2026-05-04": "五月初銀行假日",
    "2026-05-25": "春季銀行假日",
    "2026-08-31": "夏季銀行假日",
    "2026-12-25": "聖誕節",
    "2026-12-28": "節禮日補假",
    "2027-01-01": "元旦",
    "2027-03-26": "耶穌受難日",
    "2027-03-29": "復活節星期一",
    "2027-05-03": "五月初銀行假日",
    "2027-05-31": "春季銀行假日",
    "2027-08-30": "夏季銀行假日",
    "2027-12-27": "聖誕節補假",
    "2027-12-28": "節禮日補假",
  }),
});

const MARKET_ORDER = Object.freeze(["US", "JP", "UK"]);

function normalizedDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export function taipeiDateKey(date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TAIPEI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function marketClosuresOn(dateKey) {
  const normalized = normalizedDateKey(dateKey);
  if (!normalized) return [];
  return MARKET_ORDER.flatMap(marketKey => {
    const holiday = MARKET_HOLIDAYS[marketKey][normalized];
    if (!holiday) return [];
    const rule = MARKET_RULES[marketKey];
    return [{ marketKey, market: rule.label, holiday, restriction: rule.restriction }];
  });
}

export function marketHolidayNoticeForDate(dateKey) {
  const normalized = normalizedDateKey(dateKey);
  if (!normalized) return null;
  const closures = marketClosuresOn(normalized);
  if (closures.length === 0) return null;
  const [year, month, day] = normalized.split("-");
  const marketLabels = closures.map(closure => closure.market);
  const priority = closures.length === 1
    ? `今日交易${closures[0].marketKey === "UK" ? "提醒" : "限制"}：${closures[0].restriction}`
    : `今日有 ${closures.length} 個主要市場休市，請依下列各市場限制辦理。`;
  return {
    dateKey: normalized,
    dateLabel: `${year}/${Number(month)}/${Number(day)}`,
    badge: `${year}/${Number(month)}/${Number(day)}｜${marketLabels.join("、")}休市`,
    priority,
    closures,
  };
}

export function renderMarketHolidayNotice(root, date = new Date()) {
  if (!root) return null;
  const dateKey = typeof date === "string" ? date : taipeiDateKey(date);
  const notice = marketHolidayNoticeForDate(dateKey);
  root.hidden = true;
  if (!notice) return null;

  root.querySelector("[data-market-holiday-date]").textContent = notice.badge;
  root.querySelector("[data-market-holiday-priority]").textContent = notice.priority;
  const list = root.querySelector("[data-market-holiday-list]");
  list.replaceChildren(...notice.closures.map(closure => {
    const item = document.createElement("li");
    const heading = document.createElement("strong");
    heading.textContent = `${closure.market}休市（${closure.holiday}）：`;
    item.append(heading, closure.restriction);
    return item;
  }));
  root.hidden = false;
  return notice;
}

function millisecondsUntilNextTaipeiDate(now) {
  const dateKey = taipeiDateKey(now);
  if (!dateKey) return 60_000;
  const [year, month, day] = dateKey.split("-").map(Number);
  const nextMidnightUtc = Date.UTC(year, month - 1, day + 1) - (8 * 60 * 60 * 1000);
  return Math.max(1_000, nextMidnightUtc - now.getTime() + 1_000);
}

function startMarketHolidayNotice() {
  const root = document.querySelector("#marketHolidayAlert");
  if (!root) return;
  const refresh = () => {
    const now = new Date();
    renderMarketHolidayNotice(root, now);
    window.setTimeout(refresh, millisecondsUntilNextTaipeiDate(now));
  };
  refresh();
}

if (typeof document !== "undefined") startMarketHolidayNotice();
