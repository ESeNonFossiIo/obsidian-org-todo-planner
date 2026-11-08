// Pure TODO logic for an Org file, no Obsidian imports (unit-tested).
//
// A TODO is a heading with a TODO/DONE keyword; its dates sit on the line below:
//
//   * TODO Pay the rent                                          :home:
//     DEADLINE: <2026-11-10 Tue>
//   * DONE Call mum
//     CLOSED: [2026-11-07 Sat 10:12] DEADLINE: <2026-11-07 Sat>
//
// Dates are handled as "YYYY-MM-DD" keys in local time.

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** @param {number} n @returns {string} n padded to two digits */
export const pad = (n) => String(n).padStart(2, "0");

/**
 * @param {Date} d
 * @returns {string} "YYYY-MM-DD" in local time
 */
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * @param {string} key "YYYY-MM-DD"
 * @returns {Date} local midnight of that day
 */
export const keyDate = (key) => { const [y, m, d] = key.split("-").map(Number); return new Date(y, m - 1, d); };

/**
 * @param {string} key "YYYY-MM-DD"
 * @param {number} n days to add (may be negative)
 * @returns {string} the resulting key
 */
export const addDays = (key, n) => { const d = keyDate(key); d.setDate(d.getDate() + n); return dayKey(d); };

/**
 * @param {string} key "YYYY-MM-DD"
 * @returns {string} Org timestamp text like `<2026-11-10 Tue>`
 */
export const activeStamp = (key, repeat = null) =>
  `<${key} ${WEEKDAYS[keyDate(key).getDay()].slice(0, 3)}${repeat ? " " + formatRepeat(repeat) : ""}>`;

/**
 * @typedef {Object} Repeat an Org repeater such as `++1w`
 * @property {"+"|"++"|".+"} type `+` shifts the date by the interval, `++` shifts it until it
 *   is in the future (keeping the weekday), `.+` counts from the day of completion
 * @property {number} n how many units
 * @property {"h"|"d"|"w"|"m"|"y"} unit
 */

const REPEATER = /(?:^|\s)(\+\+|\.\+|\+)(\d+)([hdwmy])(?=[\s/>\]]|$)/;
const UNIT_NAMES = { h: "hour", d: "day", w: "week", m: "month", y: "year" };

/**
 * @param {string} stamp an Org timestamp such as `<2026-11-10 Tue ++1w>`
 * @returns {?Repeat} its repeater, or null if it has none
 */
export function parseRepeat(stamp) {
  const m = REPEATER.exec(stamp || "");
  return m ? { type: m[1], n: Number(m[2]), unit: m[3] } : null;
}

/**
 * @param {Repeat} r
 * @returns {string} the repeater as written in Org, e.g. `++1w`
 */
export const formatRepeat = (r) => `${r.type}${r.n}${r.unit}`;

/**
 * @param {Repeat} r
 * @returns {string} plain words, e.g. "every week" or "every 2 days"
 */
export const describeRepeat = (r) => `every ${r.n === 1 ? "" : r.n + " "}${UNIT_NAMES[r.unit]}${r.n === 1 ? "" : "s"}`;

/**
 * @param {string} key "YYYY-MM-DD"
 * @param {number} n months to add; a day that does not exist in the target month becomes its last day
 * @returns {string} the resulting key
 */
function addMonths(key, n) {
  const d = keyDate(key);
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d.getDate(), last));
  return dayKey(target);
}

/**
 * @param {string} key "YYYY-MM-DD"
 * @param {number} n units to add
 * @param {"h"|"d"|"w"|"m"|"y"} unit hours count as whole days (at least one)
 * @returns {string} the resulting key
 */
function addUnit(key, n, unit) {
  if (unit === "m") return addMonths(key, n);
  if (unit === "y") return addMonths(key, 12 * n);
  if (unit === "w") return addDays(key, 7 * n);
  return addDays(key, unit === "h" ? Math.max(1, Math.ceil(n / 24)) : n);
}

/**
 * The date a repeating TODO moves to when it is completed.
 * @param {string} key "YYYY-MM-DD" its current date
 * @param {Repeat} r
 * @param {string} today "YYYY-MM-DD"
 * @returns {string} for `+` one interval after `key`; for `++` the first date at `key` plus a
 *   whole number of intervals that is after today; for `.+` one interval after today
 */
export function nextDate(key, r, today) {
  if (r.type === ".+") return addUnit(today, r.n, r.unit);
  if (r.type === "+") return addUnit(key, r.n, r.unit);
  let k = 1;
  let d = addUnit(key, k * r.n, r.unit);
  while (d <= today && k < 10000) d = addUnit(key, ++k * r.n, r.unit);
  return d;
}

/**
 * The future occurrences of repeating TODOs that fall in a date range, as read-only copies for
 * the calendar. Only open TODOs with a date and a repeater are projected, and only days after
 * the TODO's own date and after today (an overdue one is not repeated into the past).
 * Occurrences are `date + k * interval`, so a `.+` repeater is only approximated.
 * @param {Todo[]} todos
 * @param {string} from "YYYY-MM-DD" first day of the range
 * @param {string} to "YYYY-MM-DD" last day of the range
 * @param {string} today "YYYY-MM-DD"
 * @returns {Todo[]} copies with `date` set to the occurrence, `virtual: true` and `source` the real TODO
 */
export function projectRepeats(todos, from, to, today) {
  const out = [];
  for (const t of todos) {
    if (t.state !== "TODO" || !t.repeat || !t.date) continue;
    for (let k = 1; k <= 1000; k++) {
      const d = addUnit(t.date, k * t.repeat.n, t.repeat.unit);
      if (d > to) break;
      if (d >= from && d > today) out.push(Object.assign({}, t, { date: d, virtual: true, source: t }));
    }
  }
  return out;
}

/**
 * Move a timestamp with a repeater to its next date, keeping the repeater and any time.
 * @param {string} stamp e.g. `<2026-11-10 Tue ++1w>`
 * @param {string} today "YYYY-MM-DD"
 * @returns {?{stamp: string, key: string}} the new stamp and its date, or null if it has no repeater
 */
function shiftStamp(stamp, today) {
  const r = parseRepeat(stamp);
  const old = /(\d{4}-\d{2}-\d{2})/.exec(stamp);
  if (!r || !old) return null;
  const key = nextDate(old[1], r, today);
  return { key, stamp: stamp.replace(/(\d{4}-\d{2}-\d{2})( [A-Za-zÀ-ÿ.]+)?/, `${key} ${WEEKDAYS[keyDate(key).getDay()].slice(0, 3)}`) };
}

/**
 * @param {string} value an interval such as "1w" or "2m", or "" for none
 * @param {?Repeat} previous the TODO's current repeater: if it has the same interval its type
 *   (`+`, `++`, `.+`) is kept
 * @returns {?Repeat} the repeater to store; new ones use `++`, which suits "every week" tasks
 *   that were completed late; null for empty or unreadable input
 */
export function repeatFor(value, previous) {
  const m = /^(\d+)([hdwmy])$/.exec((value || "").trim());
  if (!m) return null;
  const same = previous && previous.n === Number(m[1]) && previous.unit === m[2];
  return { type: same ? previous.type : "++", n: Number(m[1]), unit: m[2] };
}

/**
 * @param {Date} d
 * @returns {string} Org inactive timestamp with time, like `[2026-11-07 Sat 10:12]`
 */
export const inactiveStamp = (d) => `[${dayKey(d)} ${WEEKDAYS[d.getDay()].slice(0, 3)} ${pad(d.getHours())}:${pad(d.getMinutes())}]`;

/**
 * Month grid as weeks of day numbers, with null before the 1st and after the last day.
 * @param {number} year
 * @param {number} month 0-based
 * @param {boolean} mondayFirst
 * @returns {Array<Array<?number>>}
 */
export function monthGrid(year, month, mondayFirst) {
  const lead = (new Date(year, month, 1).getDay() - (mondayFirst ? 1 : 0) + 7) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/**
 * The seven days of the week containing a day.
 * @param {string} key "YYYY-MM-DD"
 * @param {boolean} mondayFirst
 * @returns {string[]} seven "YYYY-MM-DD" keys, first day of the week first
 */
export function weekDays(key, mondayFirst) {
  const back = (keyDate(key).getDay() - (mondayFirst ? 1 : 0) + 7) % 7;
  const first = addDays(key, -back);
  return Array.from({ length: 7 }, (_, i) => addDays(first, i));
}

/**
 * @param {string[]} days the seven keys of a week, as from `weekDays`
 * @returns {string} a title such as "2 Nov – 8 Nov 2026"
 */
export function weekTitle(days) {
  const [a, b] = [keyDate(days[0]), keyDate(days[6])];
  const part = (d) => `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
  return `${part(a)} – ${part(b)} ${b.getFullYear()}`;
}

/**
 * Read a due date as typed by the user.
 * Accepts: `2026-11-10`, `today`, `tomorrow`, `+3d`, `+2w`, a weekday name or its first
 * three letters (the next such day, never today). Empty input means "no date".
 * @param {string} input
 * @param {string} today "YYYY-MM-DD"
 * @returns {?string|undefined} the key; null for empty input; undefined if not understood
 */
export function parseDate(input, today) {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) {
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? dayKey(d) : undefined;
  }
  if (s === "today") return today;
  if (s === "tomorrow") return addDays(today, 1);
  if ((m = /^\+(\d+)([dw])$/.exec(s))) return addDays(today, +m[1] * (m[2] === "w" ? 7 : 1));
  if (s.length >= 3) {
    const wd = WEEKDAYS.findIndex((w) => w.toLowerCase().startsWith(s));
    if (wd >= 0) {
      const ahead = (wd - keyDate(today).getDay() + 7) % 7 || 7;
      return addDays(today, ahead);
    }
  }
  return undefined;
}

/**
 * @param {string} path a file path such as "work/home.org"
 * @returns {string} its name without folders and extension ("home"), used as the file's label
 */
export const fileLabel = (path) => path.replace(/^.*\//, "").replace(/\.org$/i, "");

/**
 * Turn what the user typed for a new TODO file into a vault path.
 * @param {string} name e.g. "things_to_buy", "work.org" or "work/home"; ".org" is added if missing
 * @param {string} [dir=""] folder (with a trailing slash) for a name that has none, e.g. "Tasks/"
 * @returns {?string} the path, or null if the name is empty or has empty, "." or ".." parts
 */
export function orgPath(name, dir = "") {
  const n = name.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!n || n.split("/").some((part) => !part.trim() || part === "." || part === "..")) return null;
  const path = /\.org$/i.test(n) ? n : n + ".org";
  if (/^\.org$/i.test(path.split("/").pop())) return null;
  return path.includes("/") ? path : dir + path;
}

/**
 * @param {string} path a TODO file path such as "work/home.org"
 * @returns {string} where its completed TODOs are archived ("work/home-archive.org")
 */
export const archivePath = (path) => path.replace(/\.org$/i, "") + "-archive.org";

/**
 * @param {string} s tag text such as "home work" or ":home:work:"
 * @returns {string[]} the tags, split on spaces, commas and colons
 */
export const parseTags = (s) => s.split(/[\s,:]+/).filter(Boolean);

const HEADING = /^(\*+)\s+(TODO|DONE)\s+(.*?)(?:\s+(:[^\s:]+(?::[^\s:]+)*:))?\s*$/;
const TOP = /^\*\s+(.*?)(?:\s+:[^\s:]+(?::[^\s:]+)*:)?\s*$/;
const TOP_TAGS = /^\*\s+(.*?)(?:\s+(:[^\s:]+(?::[^\s:]+)*:))?\s*$/;
const CHECKBOX = /^(\s*[-+]\s+)\[([ xX-])\](?:\s+(.*))?$/;

/**
 * @param {string} line
 * @returns {?string} the title if the line is a top-level heading without a TODO/DONE
 *   keyword (which makes it a list), else null
 */
function plainTop(line) {
  const m = TOP.exec(line);
  return m && !/^(TODO|DONE)(\s|$)/.test(m[1]) ? m[1] : null;
}

/**
 * @param {string} text the document
 * @returns {string[]} the list names: titles of the top-level plain headings, in file order
 */
export function listNames(text) {
  return [...new Set(text.split("\n").map(plainTop).filter(Boolean))];
}
const ANY_HEADING = /^\*+\s/;
const PLANNING = /^\s*(?:(?:SCHEDULED|DEADLINE|CLOSED):\s*[<[][^>\]]*[>\]]\s*)+$/;
const PLAN_ITEM = /(SCHEDULED|DEADLINE|CLOSED):\s*([<[][^>\]]*[>\]])/g;
const STAMP_DAY = /(\d{4}-\d{2}-\d{2})/;

/**
 * @typedef {Object} Todo
 * @property {number} line 0-based line of the heading
 * @property {number} end 0-based line after the TODO's last line (next heading or end)
 * @property {number} level heading depth (number of stars)
 * @property {"TODO"|"DONE"} state
 * @property {string} title
 * @property {string[]} tags
 * @property {?string} deadline "YYYY-MM-DD"
 * @property {?string} scheduled "YYYY-MM-DD"
 * @property {?string} date the day it belongs to: the deadline, else the scheduled day
 * @property {?string} closed "YYYY-MM-DD" it was completed
 * @property {?Repeat} repeat the repeater of its date, if it repeats
 * @property {string[]} body lines after the planning line, up to the next heading
 * @property {?string} list name of the list (top-level plain heading) it sits under; null
 *   for the default list
 * @property {Array<{line: number, checked: boolean, text: string}>} items checkbox items
 *   (`- [ ] text`) in the body, with their 0-based line
 */

/**
 * Parse every TODO/DONE heading of an Org file, in file order.
 * @param {string} text
 * @returns {Todo[]}
 */
export function parseTodos(text) {
  const lines = text.split("\n");
  const out = [];
  let top = null;   // the list the current top-level heading makes, if it is a plain one
  for (let i = 0; i < lines.length; i++) {
    if (/^\*\s/.test(lines[i])) top = plainTop(lines[i]);
    const m = HEADING.exec(lines[i]);
    if (!m) continue;
    let end = i + 1;
    while (end < lines.length && !ANY_HEADING.test(lines[end])) end++;
    const plan = {};
    const raw = {};
    let bodyFrom = i + 1;
    if (bodyFrom < end && PLANNING.test(lines[bodyFrom])) {
      for (const p of lines[bodyFrom].matchAll(PLAN_ITEM)) {
        plan[p[1]] = (STAMP_DAY.exec(p[2]) || [])[1] || null;
        raw[p[1]] = p[2];
      }
      bodyFrom++;
    }
    out.push({
      line: i, end, level: m[1].length, state: m[2], title: m[3],
      tags: m[4] ? m[4].split(":").filter(Boolean) : [],
      deadline: plan.DEADLINE || null, scheduled: plan.SCHEDULED || null,
      date: plan.DEADLINE || plan.SCHEDULED || null,
      closed: plan.CLOSED || null,
      repeat: parseRepeat(plan.DEADLINE ? raw.DEADLINE : raw.SCHEDULED),
      body: lines.slice(bodyFrom, end).filter((l, j, a) => l.trim() || j < a.length - 1),
      list: m[1].length > 1 ? top : null,
      items: lines.slice(bodyFrom, end).flatMap((l, j) => {
        const c = CHECKBOX.exec(l);
        return c ? [{ line: bodyFrom + j, checked: c[2] === "x" || c[2] === "X", text: (c[3] || "").trim() }] : [];
      }),
    });
  }
  return out;
}

/**
 * Group TODOs by day.
 * @param {Todo[]} todos
 * @returns {{byDay: Map<string, Todo[]>, undated: Todo[]}} TODOs per "YYYY-MM-DD" key, in
 *   file order, and those without a date
 */
export function groupByDay(todos) {
  const byDay = new Map();
  const undated = [];
  for (const t of todos) {
    if (!t.date) { undated.push(t); continue; }
    if (!byDay.has(t.date)) byDay.set(t.date, []);
    byDay.get(t.date).push(t);
  }
  return { byDay, undated };
}

/**
 * @param {Todo} t
 * @param {string} today "YYYY-MM-DD"
 * @returns {boolean} true if the TODO is open and its day is before today
 */
export const isOverdue = (t, today) => t.state === "TODO" && !!t.date && t.date < today;

/**
 * Per-day summary for the calendar dots.
 * @param {Todo[]} todos
 * @param {string} today "YYYY-MM-DD"
 * @returns {Map<string, {open: number, done: number, overdue: boolean}>}
 */
export function daySummary(todos, today) {
  const out = new Map();
  for (const t of todos) {
    if (!t.date) continue;
    const s = out.get(t.date) || { open: 0, done: 0, overdue: false };
    if (t.state === "TODO") s.open++; else s.done++;
    if (isOverdue(t, today)) s.overdue = true;
    out.set(t.date, s);
  }
  return out;
}

/**
 * Add padding so `:tags:` end at `column` (Org's default is 77); one space at least.
 * @param {string} head the heading without tags
 * @param {string[]} tags
 * @param {number} column
 * @returns {string}
 */
function withTags(head, tags, column) {
  if (!tags.length) return head;
  const t = `:${tags.join(":")}:`;
  return head + " ".repeat(Math.max(1, column - head.length - t.length)) + t;
}

/**
 * @param {string[]} lines the document lines
 * @param {number} line 0-based heading line
 * @returns {{DEADLINE?: string, SCHEDULED?: string, CLOSED?: string}} the timestamps of the
 *   planning line below the heading, as written
 */
function planningItems(lines, line) {
  const items = {};
  if (line + 1 < lines.length && PLANNING.test(lines[line + 1])) {
    for (const p of lines[line + 1].matchAll(PLAN_ITEM)) items[p[1]] = p[2];
  }
  return items;
}

/**
 * Rewrite the planning line below a heading (SCHEDULED/DEADLINE/CLOSED), keeping the
 * items that are not mentioned in `changes`.
 * @param {string[]} lines the document lines; edited in place
 * @param {number} line 0-based heading line
 * @param {{DEADLINE?: ?string, SCHEDULED?: ?string, CLOSED?: ?string}} changes the new
 *   timestamp text for an item, or null to remove it
 * @returns {void}
 */
function setPlanning(lines, line, changes) {
  const has = line + 1 < lines.length && PLANNING.test(lines[line + 1]);
  const items = planningItems(lines, line);
  for (const [k, v] of Object.entries(changes)) { if (v) items[k] = v; else delete items[k]; }
  const text = ["CLOSED", "DEADLINE", "SCHEDULED"].filter((k) => items[k]).map((k) => `${k}: ${items[k]}`).join(" ");
  if (has) lines.splice(line + 1, 1, ...(text ? ["  " + text] : []));
  else if (text) lines.splice(line + 1, 0, "  " + text);
}

/**
 * Where a TODO under `list` goes in a document: the end of that list's section, or the end of
 * the file when there is no list. A missing list heading is pushed on `lines` first.
 * @param {string[]} lines the document lines (without the empty piece after a final newline);
 *   edited in place when the list has to be created
 * @param {?string} list
 * @returns {number} index at which to insert the TODO's lines
 */
function insertionPoint(lines, list) {
  if (!list) return lines.length;
  const start = lines.findIndex((l) => plainTop(l) === list);
  if (start < 0) { lines.push(`* ${list}`); return lines.length; }
  let at = start + 1;
  while (at < lines.length && !/^\*\s/.test(lines[at])) at++;
  while (at > start + 1 && !lines[at - 1].trim()) at--;
  return at;
}

/**
 * @param {string} text
 * @returns {string[]} the document's lines, without the empty piece after a final newline
 *   (none at all for an empty document)
 */
function docLines(text) {
  const lines = text.length ? text.replace(/\n?$/, "\n").split("\n") : [""];
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * @param {string[]} lines the document lines (as `text.split("\n")`)
 * @param {number} line 0-based heading line
 * @param {number} level the heading's depth
 * @returns {number} the line after the heading's whole subtree: its text, checkboxes and
 *   deeper headings, up to the next heading of the same or a shallower depth
 */
function subtreeEnd(lines, line, level) {
  const n = lines.length - (lines[lines.length - 1] === "" ? 1 : 0);   // ignore the piece after a final newline
  let end = line + 1;
  while (end < n && !(ANY_HEADING.test(lines[end]) && /^\*+/.exec(lines[end])[0].length <= level)) end++;
  return end;
}

/**
 * Add a TODO. Without a list it goes at the end of the file as a top-level heading; with a
 * list it goes at the end of that list's section as a second-level heading (the list is
 * created at the end of the file if it does not exist).
 * @param {string} text the document
 * @param {{title: string, due?: ?string, tags?: string[], list?: ?string, repeat?: ?Repeat}} todo
 *   `due` is "YYYY-MM-DD"; `repeat` only applies when there is a due date
 * @param {number} [column=77] where the tags end
 * @returns {{text: string, line: number}} the new document and the 0-based heading line
 */
export function addTodo(text, { title, due = null, tags = [], list = null, repeat = null }, column = 77) {
  const lines = docLines(text);
  const at = insertionPoint(lines, list);
  const block = [withTags(`${list ? "**" : "*"} TODO ${title}`, tags, column)];
  if (due) block.push("  DEADLINE: " + activeStamp(due, repeat));
  lines.splice(at, 0, ...block);
  return { text: lines.join("\n") + "\n", line: at };
}

/**
 * Add an empty list (a top-level heading) at the end of the file, unless it exists.
 * @param {string} text the document
 * @param {string} name
 * @returns {string} the new document
 */
export function addList(text, name) {
  if (listNames(text).includes(name)) return text;
  return (text && !text.endsWith("\n") ? text + "\n" : text) + `* ${name}\n`;
}

/**
 * Tick or untick the checkbox item on a line.
 * @param {string} text the document
 * @param {number} line 0-based
 * @returns {string} the new document (unchanged if the line is not a checkbox item)
 */
export function toggleItem(text, line) {
  const lines = text.split("\n");
  const m = CHECKBOX.exec(lines[line] || "");
  if (!m) return text;
  lines[line] = lines[line].replace(/\[[ xX-]\]/, m[2] === " " ? "[X]" : "[ ]");
  return lines.join("\n");
}

/**
 * Add a checkbox item to the TODO at `line`: after its last item, or at the end of its text.
 * @param {string} text the document
 * @param {number} line 0-based heading line of the TODO
 * @param {string} label
 * @returns {string} the new document (unchanged if the line is not a TODO heading)
 */
export function addItem(text, line, label) {
  const t = parseTodos(text).find((x) => x.line === line);
  if (!t) return text;
  const lines = text.split("\n");
  const { at, prefix } = itemSlot(lines, t);
  lines.splice(at, 0, `${prefix}[ ] ${label}`);
  return lines.join("\n");
}

/**
 * Where a new checkbox item of a TODO goes: after its last item, or else at the end of its text.
 * @param {string[]} lines the document lines
 * @param {Todo} t the TODO
 * @returns {{at: number, prefix: string}} the line index to insert at and the item prefix to use
 *   (the last item's, e.g. "  - ", else two spaces and a dash)
 */
function itemSlot(lines, t) {
  let at = t.end;
  while (at > t.line + 1 && !lines[at - 1].trim()) at--;
  let prefix = "  - ";
  if (t.items.length) {
    const last = t.items[t.items.length - 1];
    prefix = CHECKBOX.exec(lines[last.line])[1];
    at = last.line + 1;
  }
  return { at, prefix };
}

/**
 * The lines a TODO and everything under it span.
 * @param {string} text the document
 * @param {number} line 0-based heading line
 * @returns {?{start: number, end: number}} the first line and the line after the last one; null if
 *   `line` is not a TODO heading
 */
export function todoSubtree(text, line) {
  const t = parseTodos(text).find((x) => x.line === line);
  return t ? { start: line, end: subtreeEnd(text.split("\n"), line, t.level) } : null;
}

/**
 * Turn a checkbox item into a task: the item's line is removed from its TODO and a new TODO with
 * its text goes to the end of a list (or of the file). Items and notes nested under it come along as
 * the new task's own items and notes; a ticked item becomes DONE.
 * @param {string} text the document
 * @param {number} todoLine 0-based heading line of the TODO the item belongs to
 * @param {number} itemLine 0-based line of the checkbox item
 * @param {{list?: ?string, due?: ?string, now?: Date, column?: number}} [opts] `list` is the list
 *   the new task goes into (null: the end of the file, outside any list), `due` its "YYYY-MM-DD"
 *   deadline, `now` the time for the `CLOSED:` stamp of a DONE task, `column` where tags end
 * @returns {?{text: string, line: number}} the new document and the new TODO's heading line; null
 *   if the line is not a non-empty checkbox item of that TODO
 */
export function promoteItem(text, todoLine, itemLine, { list = null, due = null, now = new Date(), column = 77 } = {}) {
  const t = parseTodos(text).find((x) => x.line === todoLine);
  const item = t && t.items.find((i) => i.line === itemLine);
  if (!item || !item.text) return null;
  const lines = text.split("\n");
  const indentOf = (l) => /^\s*/.exec(l)[0].length;
  const base = indentOf(lines[itemLine]);
  let end = itemLine + 1;
  while (end < t.end && lines[end].trim() && indentOf(lines[end]) > base) end++;
  const body = lines.slice(itemLine + 1, end).map((l) => "  " + " ".repeat(Math.max(0, indentOf(l) - base - 2)) + l.trim());
  lines.splice(itemLine, end - itemLine);
  const added = addTodo(lines.join("\n"), { title: item.text, due, list }, column);
  let out = item.checked ? setState(added.text, added.line, "DONE", now) : added.text;
  if (body.length) {
    const arr = out.split("\n");
    const fresh = parseTodos(out).find((x) => x.line === added.line);
    let at = fresh.end;
    while (at > fresh.line + 1 && !arr[at - 1].trim()) at--;
    arr.splice(at, 0, ...body);
    out = arr.join("\n");
  }
  return { text: out, line: added.line };
}

/**
 * @param {string[]} lines document lines
 * @param {number} from first line of a block
 * @param {number} end line after the block
 * @param {number} shift stars to add (or, if negative, remove) on every heading in the block
 * @returns {string[]} the block's lines with the headings re-levelled (never below one star)
 */
function releveled(lines, from, end, shift) {
  return lines.slice(from, end).map((l) => {
    const m = /^(\*+)(\s.*)?$/.exec(l);
    return m && ANY_HEADING.test(l) ? "*".repeat(Math.max(1, m[1].length + shift)) + (m[2] || "") : l;
  });
}

/**
 * Move a TODO, with everything under it, to just before or after another TODO of the same
 * document. It takes the other TODO's depth, so it joins that TODO's list.
 * @param {string} text the document
 * @param {number} srcLine 0-based heading line of the TODO to move
 * @param {number} dstLine 0-based heading line of the TODO it is placed next to
 * @param {"before"|"after"} where
 * @returns {?string} the new document (equal to `text` if nothing moved); null if either line is
 *   not a TODO heading, they are the same, or the target is one of the moved TODO's own sub-TODOs
 */
export function reorderTodo(text, srcLine, dstLine, where) {
  const todos = parseTodos(text);
  const src = todos.find((x) => x.line === srcLine);
  const dst = todos.find((x) => x.line === dstLine);
  if (!src || !dst || src.line === dst.line) return null;
  const lines = text.split("\n");
  const end = subtreeEnd(lines, src.line, src.level);
  if (dst.line > src.line && dst.line < end) return null;
  let at = where === "after" ? subtreeEnd(lines, dst.line, dst.level) : dst.line;
  const block = releveled(lines, src.line, end, dst.level - src.level);
  lines.splice(src.line, end - src.line);
  if (at >= end) at -= end - src.line;
  lines.splice(at, 0, ...block);
  return lines.join("\n");
}

/**
 * Move a TODO, with everything under it, to the end of a list (or of the file, outside any list).
 * @param {string} text the document
 * @param {number} srcLine 0-based heading line of the TODO
 * @param {?string} list the list name (created at the end of the file if missing), or null
 * @returns {?string} the new document; null if the line is not a TODO heading
 */
export function moveTodoToList(text, srcLine, list) {
  const t = parseTodos(text).find((x) => x.line === srcLine);
  if (!t) return null;
  const lines = text.split("\n");
  const end = subtreeEnd(lines, t.line, t.level);
  const block = releveled(lines, t.line, end, (list ? 2 : 1) - t.level);
  lines.splice(t.line, end - t.line);
  const doc = docLines(lines.join("\n"));
  doc.splice(insertionPoint(doc, list), 0, ...block);
  return doc.join("\n") + "\n";
}

/**
 * The neighbour a TODO swaps places with when moved up or down: the nearest open TODO of the same
 * depth before or after it, in the same list (done TODOs are skipped; a plain heading, such as the
 * next list, or a shallower heading ends the search).
 * @param {string} text the document
 * @param {number} line 0-based heading line of the TODO
 * @param {-1|1} dir -1 for the one before, 1 for the one after
 * @returns {?number} the neighbour's heading line, or null if there is none
 */
export function siblingTodo(text, line, dir) {
  const src = parseTodos(text).find((x) => x.line === line);
  if (!src) return null;
  const lines = text.split("\n");
  const from = dir < 0 ? line - 1 : subtreeEnd(lines, line, src.level);
  for (let i = from; i >= 0 && i < lines.length; i += dir) {
    const m = /^(\*+)\s+(TODO|DONE)?/.exec(lines[i]);
    if (!m) continue;
    if (m[1].length < src.level || (m[1].length === src.level && !m[2])) return null;
    if (m[1].length === src.level && m[2] === "TODO") return i;
  }
  return null;
}

/**
 * Make a TODO a sub-item of another one: it becomes a checkbox item (`- [ ] title`, `- [X]` if it
 * was DONE) after the other TODO's last item, and its own text, items and sub-TODOs follow as
 * nested checkbox items. What a checkbox cannot hold is not kept: due date, repeat and tags (of the
 * TODO and of its sub-TODOs); they are reported in `loss`.
 * @param {string} text the document
 * @param {number} srcLine 0-based heading line of the TODO to convert
 * @param {number} dstLine 0-based heading line of the TODO it becomes a sub-item of
 * @returns {?{text: string, loss: string[]}} the new document and what is lost ("due date",
 *   "repeat", "tags"); null if either line is not a TODO heading, they are the same, or the
 *   target is one of the source's own sub-TODOs
 */
export function nestTodo(text, srcLine, dstLine) {
  const todos = parseTodos(text);
  const src = todos.find((x) => x.line === srcLine);
  const dst = todos.find((x) => x.line === dstLine);
  if (!src || !dst || src.line === dst.line) return null;
  const lines = text.split("\n");
  const end = subtreeEnd(lines, src.line, src.level);
  if (dst.line > src.line && dst.line < end) return null;
  const { at, prefix } = itemSlot(lines, dst);
  const base = /^\s*/.exec(prefix)[0];
  const loss = [];
  const out = [];
  for (const t of todos.filter((x) => x.line >= src.line && x.line < end)) {
    const depth = Math.max(0, t.level - src.level);
    const pad = base + "  ".repeat(depth);
    const box = (done) => `[${done ? "X" : " "}]`;
    out.push(`${depth === 0 ? prefix : pad + "- "}${box(t.state === "DONE")} ${t.title}`);
    for (const it of t.items) out.push(`${pad}  - ${box(it.checked)} ${it.text}`);
    for (const l of t.body) if (l.trim() && !CHECKBOX.test(l)) out.push(`${pad}  ${l.trim()}`);
    for (const [what, has] of [["due date", t.date], ["repeat", t.repeat], ["tags", t.tags.length]]) {
      if (has && !loss.includes(what)) loss.push(what);
    }
  }
  lines.splice(src.line, end - src.line);
  const ins = at >= end ? at - (end - src.line) : at;
  lines.splice(ins, 0, ...out);
  return { text: lines.join("\n"), loss };
}

/**
 * Mark the TODO at `line` as done or open again. Done adds `CLOSED: [now]`, reopening removes it.
 * @param {string} text the document
 * @param {number} line 0-based heading line
 * @param {"TODO"|"DONE"} state
 * @param {Date} now
 * @returns {string} the new document (unchanged if the line is not a TODO heading)
 */
export function setState(text, line, state, now) {
  const lines = text.split("\n");
  if (!HEADING.test(lines[line] || "")) return text;
  lines[line] = lines[line].replace(/^(\*+\s+)(?:TODO|DONE)/, `$1${state}`);
  setPlanning(lines, line, { CLOSED: state === "DONE" ? inactiveStamp(now) : null });
  return lines.join("\n");
}

/**
 * Set, change or clear the deadline of the TODO at `line`.
 * @param {string} text the document
 * @param {number} line 0-based heading line
 * @param {?string} due "YYYY-MM-DD", or null to remove the deadline (and its repeater)
 * @param {?Repeat} [repeat] the new repeater, null for none; if left out the deadline's
 *   current repeater is kept
 * @returns {string} the new document (unchanged if the line is not a TODO heading)
 */
export function setDue(text, line, due, repeat) {
  const lines = text.split("\n");
  if (!HEADING.test(lines[line] || "")) return text;
  const rep = repeat === undefined ? parseRepeat(planningItems(lines, line).DEADLINE) : repeat;
  setPlanning(lines, line, { DEADLINE: due ? activeStamp(due, rep) : null });
  return lines.join("\n");
}

/**
 * Complete the TODO at `line`. A TODO whose date repeats is not closed: its date moves to the
 * next one (see `nextDate`), its tick-box items are cleared and it stays open. Any other TODO
 * becomes DONE with a `CLOSED:` stamp, as in `setState`.
 * @param {string} text the document
 * @param {number} line 0-based heading line
 * @param {Date} now
 * @returns {{text: string, next: ?string}} the new document and, for a repeating TODO, its new
 *   date ("YYYY-MM-DD"); null otherwise
 */
export function completeTodo(text, line, now) {
  const t = parseTodos(text).find((x) => x.line === line && x.state === "TODO");
  const lines = text.split("\n");
  const items = t ? planningItems(lines, line) : {};
  const today = dayKey(now);
  const moved = {};
  let next = null;
  for (const k of ["DEADLINE", "SCHEDULED"]) {
    const shifted = items[k] && shiftStamp(items[k], today);
    if (shifted) { moved[k] = shifted.stamp; if (!next || k === "DEADLINE") next = shifted.key; }
  }
  if (!next) return { text: setState(text, line, "DONE", now), next: null };
  for (const it of t.items) lines[it.line] = lines[it.line].replace(/\[[xX-]\]/, "[ ]");
  setPlanning(lines, line, { ...moved, CLOSED: null });
  return { text: lines.join("\n"), next };
}

const PLANNER_KEY = /^#\+PLANNER:\s*(.*?)\s*$/i;

/**
 * What the header of an Org file (the lines before the first heading) says about opening it as
 * tasks: a `#+PLANNER:` line whose value is `off`, `no`, `false`, `text` or `0` means "no"; any
 * other value (usually `tasks`) means "yes".
 * @param {string} text the file's text
 * @returns {?boolean} true, false, or null if the header has no `#+PLANNER:` line
 */
export function plannerSetting(text) {
  for (const line of text.split("\n")) {
    if (/^\*+\s/.test(line)) return null;
    const m = PLANNER_KEY.exec(line);
    if (m) return !/^(off|no|false|text|0)$/i.test(m[1]);
  }
  return null;
}

/**
 * @param {string} text the file's text
 * @returns {boolean} whether its header asks to be opened as tasks (`#+PLANNER: tasks`)
 */
export const hasPlannerMarker = (text) => plannerSetting(text) === true;

/**
 * @param {string} path
 * @returns {boolean} whether it is an archive file written by the plugin (`<name>-archive.org`)
 */
export const isArchivePath = (path) => /-archive\.org$/i.test(path);

/**
 * Whether a file is a TODO file because it sits in a task folder: an `.org` file, not an archive,
 * anywhere below one of the folders.
 * @param {string} path vault path of the file
 * @param {string[]} folders vault folders, e.g. "Tasks" (slashes at the ends are ignored; empty
 *   entries are ignored)
 * @returns {boolean}
 */
export function inTaskFolder(path, folders) {
  if (!/\.org$/i.test(path) || isArchivePath(path)) return false;
  return folders.some((f) => {
    const dir = f.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    return dir !== "" && path.startsWith(dir + "/");
  });
}

/**
 * Make a file open as tasks: add `#+PLANNER: tasks` after the `#+` lines at the top of the file
 * (or turn an existing `#+PLANNER: off` into it).
 * @param {string} text the file's text
 * @returns {string} the new text (unchanged if the marker is already there)
 */
export function addPlannerMarker(text) {
  if (hasPlannerMarker(text)) return text;
  const lines = text.split("\n");
  let end = 0;
  while (end < lines.length && /^#\+/.test(lines[end])) end++;
  const off = lines.findIndex((l, i) => i < end && PLANNER_KEY.test(l));
  if (off >= 0) lines[off] = "#+PLANNER: tasks";
  else lines.splice(end, 0, "#+PLANNER: tasks");
  return lines.join("\n");
}

/**
 * @param {string} name a proposed list name
 * @returns {boolean} whether it can be a list's heading text: one line, not empty, and not
 *   something that would read as a task (`TODO ...`) or carry tags (`... :tag:`)
 */
export function isListName(name) {
  const n = name.trim();
  return !!n && !/[\r\n]/.test(name) && plainTop(`* ${n}`) === n;
}

/**
 * Rename the TODO at `line`; its state, depth and tags (re-aligned to `column`), date and
 * everything under it stay as they are.
 * @param {string} text the document
 * @param {number} line 0-based heading line
 * @param {string} title the new title
 * @param {number} [column=77] where the tags end
 * @returns {string} the new document; unchanged if the line is not a TODO heading or the title is
 *   empty, has several lines, or would not read back as that title (e.g. it ends in `:tag:`)
 */
export function renameTodo(text, line, title, column = 77) {
  const lines = text.split("\n");
  const m = HEADING.exec(lines[line] || "");
  const t = title.trim();
  if (!m || !t || /[\r\n]/.test(title)) return text;
  lines[line] = withTags(`${m[1]} ${m[2]} ${t}`, m[4] ? m[4].split(":").filter(Boolean) : [], column);
  const out = lines.join("\n");
  const back = parseTodos(out).find((x) => x.line === line);
  return back && back.title === t && back.state === m[2] ? out : text;
}

/**
 * Rename a list: every top-level heading with that name keeps its tags and everything under it.
 * @param {string} text the document
 * @param {string} name the current list name
 * @param {string} newName the new name (see `isListName`)
 * @param {number} [column=77] where the tags end
 * @returns {{text: string, count: number}} the new document and how many headings were renamed;
 *   unchanged and 0 if there is no such list, the name is not usable or is the same
 */
export function renameList(text, name, newName, column = 77) {
  const n = newName.trim();
  if (!isListName(n) || n === name) return { text, count: 0 };
  const lines = text.split("\n");
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!/^\*\s/.test(lines[i]) || plainTop(lines[i]) !== name) continue;
    const m = TOP_TAGS.exec(lines[i]);
    lines[i] = withTags(`* ${n}`, m && m[2] ? m[2].split(":").filter(Boolean) : [], column);
    count++;
  }
  return count ? { text: lines.join("\n"), count } : { text, count: 0 };
}

/**
 * Move a list, with everything under its heading, before or after another list. A list's section
 * runs from its top-level heading to the next top-level heading; top-level tasks between lists
 * stay where they are.
 * @param {string} text the document
 * @param {string} name the list to move
 * @param {string} targetName the list it is placed next to
 * @param {"before"|"after"} where
 * @returns {?string} the new document (equal to `text` if nothing moved); null if either list is
 *   missing or they are the same
 */
export function reorderList(text, name, targetName, where) {
  if (name === targetName) return null;
  const lines = text.split("\n");
  const n = lines.length - (lines[lines.length - 1] === "" ? 1 : 0);   // ignore the piece after a final newline
  const section = (title) => {
    const start = lines.findIndex((l, i) => i < n && /^\*\s/.test(l) && plainTop(l) === title);
    if (start < 0) return null;
    let end = start + 1;
    while (end < n && !/^\*\s/.test(lines[end])) end++;
    return { start, end };
  };
  const src = section(name);
  const dst = section(targetName);
  if (!src || !dst) return null;
  const block = lines.slice(src.start, src.end);
  let at = where === "after" ? dst.end : dst.start;
  lines.splice(src.start, src.end - src.start);
  if (at >= src.end) at -= src.end - src.start;
  lines.splice(at, 0, ...block);
  return lines.join("\n");
}

/**
 * Delete a checkbox item (`- [ ] text`).
 * @param {string} text the document
 * @param {number} line 0-based line of the item
 * @returns {string} the new document (unchanged if the line is not a checkbox item)
 */
export function deleteItem(text, line) {
  const lines = text.split("\n");
  if (!CHECKBOX.test(lines[line] || "")) return text;
  lines.splice(line, 1);
  return lines.join("\n");
}

/**
 * Delete a list: its top-level heading and everything under it, up to the next top-level
 * heading (its tasks, their notes and sub-items, and any other text or sub-headings there).
 * Every section with that name is removed.
 * @param {string} text the document
 * @param {string} name the list name
 * @returns {{text: string, count: number}} the new document and how many TODO/DONE headings
 *   were removed; unchanged and 0 if there is no such list
 */
export function deleteList(text, name) {
  const lines = text.split("\n");
  const n = lines.length - (lines[lines.length - 1] === "" ? 1 : 0);   // ignore the piece after a final newline
  const gone = new Set();
  let inside = false;
  for (let i = 0; i < n; i++) {
    if (/^\*\s/.test(lines[i])) inside = plainTop(lines[i]) === name;
    if (inside) gone.add(i);
  }
  if (!gone.size) return { text, count: 0 };
  const count = parseTodos(text).filter((t) => gone.has(t.line)).length;
  return { text: lines.filter((_, i) => !gone.has(i)).join("\n"), count };
}

/**
 * Delete the TODO at `line` with everything under it: its notes, checkboxes and child headings.
 * @param {string} text the document
 * @param {number} line 0-based heading line
 * @returns {{text: string, count: number}} the new document and how many TODO/DONE headings were
 *   removed (the TODO itself and any below it); unchanged and 0 if `line` is not a TODO heading
 */
export function deleteTodo(text, line) {
  const t = parseTodos(text).find((x) => x.line === line);
  if (!t) return { text, count: 0 };
  const lines = text.split("\n");
  const end = subtreeEnd(lines, line, t.level);
  const count = parseTodos(text).filter((x) => x.line >= line && x.line < end).length;
  lines.splice(line, end - line);
  return { text: lines.join("\n"), count };
}

/**
 * Split the completed TODOs (with their sub-items) off a document. A DONE TODO that still
 * has an open TODO below it is kept, so no open work is moved.
 * @param {string} text the document
 * @returns {{text: string, archived: string, count: number}} the document without them, the
 *   removed blocks as Org text (empty if none), and how many DONE TODOs they hold
 */
export function archiveDone(text) {
  const lines = text.split("\n");
  const todos = parseTodos(text);
  const blocks = [];
  let upto = -1;
  for (const t of todos) {
    if (t.state !== "DONE" || t.line < upto) continue;
    const end = subtreeEnd(lines, t.line, t.level);
    if (todos.some((x) => x.state === "TODO" && x.line > t.line && x.line < end)) continue;
    blocks.push([t.line, end]);
    upto = end;
  }
  if (!blocks.length) return { text, archived: "", count: 0 };
  const gone = new Set(blocks.flatMap(([a, b]) => Array.from({ length: b - a }, (_, i) => a + i)));
  const count = todos.filter((t) => t.state === "DONE" && gone.has(t.line)).length;
  return {
    text: lines.filter((_, i) => !gone.has(i)).join("\n"),
    archived: blocks.map(([a, b]) => lines.slice(a, b).join("\n") + "\n").join(""),
    count,
  };
}

/**
 * Move a TODO, with its notes, checkboxes and child headings, out of one document into another.
 * A TODO that sits under a list goes to the same-named list of the destination (created if
 * missing) as a second-level heading; any other TODO goes to the end as a top-level one, and
 * child headings keep their depth relative to it.
 * @param {string} src the document the TODO is in
 * @param {number} line 0-based heading line of the TODO in `src`
 * @param {string} dst the document to move it to (may be empty)
 * @returns {?{src: string, dst: string, line: number}} both new documents and the TODO's heading
 *   line in `dst`; null if `line` is not a TODO heading
 */
export function moveTodo(src, line, dst) {
  const t = parseTodos(src).find((x) => x.line === line);
  if (!t) return null;
  const srcLines = src.split("\n");
  const end = subtreeEnd(srcLines, line, t.level);
  const shift = (t.list ? 2 : 1) - t.level;
  const block = srcLines.slice(line, end).map((l) => {
    const m = /^(\*+)(\s.*)?$/.exec(l);
    return m && ANY_HEADING.test(l) ? "*".repeat(Math.max(1, m[1].length + shift)) + (m[2] || "") : l;
  });
  while (block.length > 1 && !block[block.length - 1].trim()) block.pop();
  const dstLines = docLines(dst);
  const at = insertionPoint(dstLines, t.list);
  dstLines.splice(at, 0, ...block);
  srcLines.splice(line, end - line);
  return { src: srcLines.join("\n"), dst: dstLines.join("\n") + "\n", line: at };
}

/**
 * @param {string} text
 * @param {number} line 0-based
 * @returns {number} character offset of the start of that line
 */
export function lineOffset(text, line) {
  let off = 0;
  for (let i = 0; i < line; i++) off = text.indexOf("\n", off) + 1;
  return off;
}
