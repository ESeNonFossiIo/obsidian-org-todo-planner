// The planner pane: a month calendar (a dot per day with TODOs, red when something is
// overdue) above the list of TODOs for the selected day. Redraws when the TODO file changes.
import { ItemView, setIcon } from "obsidian";
import { TASKS_VIEW } from "./tasks.js";
import { MONTHS, WEEKDAYS, fileLabel, describeRepeat, projectRepeats, weekTitle, pad, dayKey, keyDate, addDays, weekDays, monthGrid, groupByDay, daySummary, isOverdue } from "./core.js";

/** Obsidian view type id for the planner. */
export const PLANNER_VIEW = "org-todo-planner";

/**
 * The planner view. `year`/`month` (0-based) are the month shown, `selected` is the
 * "YYYY-MM-DD" day whose TODOs are listed; `plugin` supplies settings and the TODO actions.
 */
export class PlannerView extends ItemView {
  /**
   * @param {import("obsidian").WorkspaceLeaf} leaf
   * @param {import("./main.js").default} plugin supplies the settings, the TODOs and the actions
   */
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    const now = new Date();
    this.year = now.getFullYear();
    this.month = now.getMonth();
    this.selected = dayKey(now);
  }
  /**
   * @returns {string} the view type id
   */
  getViewType() { return PLANNER_VIEW; }
  /**
   * @returns {string} the tab title
   */
  getDisplayText() { return "Todo planner"; }
  /**
   * @returns {string} the tab icon
   */
  getIcon() { return "calendar-check"; }
  /**
   * Start in the configured default view, redraw when the TODO file is saved, then draw
   * for the first time.
   * @returns {Promise<void>}
   */
  async onOpen() {
    const { defaultView } = this.plugin.settings;
    if (defaultView !== "last") this.plugin.settings.plannerMode = defaultView;
    this.registerEvent(this.app.vault.on("modify", (f) => {
      if (this.plugin.isTodoFile(f.path)) this.render();
    }));
    await this.render();
  }
  /**
   * Move `delta` months (month mode) or weeks (week mode) from the current position.
   * @param {number} delta e.g. -1 for the previous one
   * @returns {void}
   */
  shift(delta) {
    if (this.plugin.settings.plannerMode === "week") { this.select(addDays(this.selected, 7 * delta)); return; }
    const d = new Date(this.year, this.month + delta, 1);
    this.year = d.getFullYear();
    this.month = d.getMonth();
    this.render();
  }
  /**
   * Select a day and show its month.
   * @param {string} key "YYYY-MM-DD"
   * @returns {void}
   */
  select(key) {
    const d = keyDate(key);
    this.selected = key;
    this.year = d.getFullYear();
    this.month = d.getMonth();
    this.render();
  }
  /**
   * Rebuild the pane: calendar on top, the day's list below.
   * @returns {Promise<void>}
   */
  async render() {
    const el = this.contentEl;
    const real = (await this.plugin.snapshot()).todos;
    const today = dayKey(new Date());
    const week = this.plugin.settings.plannerMode === "week";
    const [from, to] = this.visibleRange(week);
    const todos = real.concat(projectRepeats(real, from, to, today));
    el.empty();
    el.addClass("todo-planner");
    const done = real.filter((t) => t.state === "DONE").length;
    this.drawHead(el.createDiv({ cls: "todo-planner-head" }), el.createDiv({ cls: "todo-planner-head todo-planner-tools" }), week, today, done);
    if (week) { this.drawWeek(el.createDiv(), todos, today); return; }
    this.drawCalendar(el.createDiv(), todos, today);
    this.drawList(el.createDiv({ cls: "todo-planner-list" }), todos, today);
  }
  /**
   * The days that are on screen, for projecting repeating TODOs: the shown week, or the shown
   * month plus the selected day (which may be in another month).
   * @param {boolean} week true in week mode
   * @returns {[string, string]} first and last "YYYY-MM-DD"
   */
  visibleRange(week) {
    if (week) {
      const days = weekDays(this.selected, this.plugin.settings.mondayFirst);
      return [days[0], days[6]];
    }
    const first = `${this.year}-${pad(this.month + 1)}-01`;
    const last = dayKey(new Date(this.year, this.month + 1, 0));
    return [first < this.selected ? first : this.selected, last > this.selected ? last : this.selected];
  }
  /**
   * Draw the two header rows. `nav`: previous, title, next and Today. `tools`: the Month/Week
   * switch on the left; on the right the show/hide-completed eye, the archive button (only if
   * there are completed TODOs) and the button that opens the Tasks pane.
   * @param {HTMLElement} nav
   * @param {HTMLElement} tools
   * @param {boolean} week true in week mode
   * @param {string} today "YYYY-MM-DD"
   * @param {number} done how many completed TODOs there are
   * @returns {void}
   */
  drawHead(nav, tools, week, today, done) {
    nav.createEl("button", { text: "‹" }).onclick = () => this.shift(-1);
    let title = `${MONTHS[this.month]} ${this.year}`;
    if (week) title = weekTitle(weekDays(this.selected, this.plugin.settings.mondayFirst));
    nav.createSpan({ cls: "todo-planner-title", text: title });
    nav.createEl("button", { text: "›" }).onclick = () => this.shift(1);
    nav.createEl("button", { text: "Today" }).onclick = () => this.select(today);

    tools.createEl("button", { text: week ? "Month" : "Week", title: week ? "Show the month" : "Show the week" }).onclick = async () => {
      this.plugin.settings.plannerMode = week ? "month" : "week";
      await this.plugin.saveSettings();
      this.render();
    };
    const files = this.plugin.files();
    if (files.length > 1) {
      const pick = tools.createEl("select", { cls: "dropdown", title: "Show one file or all of them" });
      for (const [value, label] of [["", "All files"], ...files.map((f) => [f, fileLabel(f)])]) {
        pick.createEl("option", { text: label }).value = value;
      }
      pick.value = this.plugin.scopedFiles().length === 1 ? this.plugin.scopedFiles()[0] : "";
      pick.onchange = () => this.plugin.setScope(pick.value || null);
    }
    tools.createDiv({ cls: "todo-planner-spacer" });
    const shown = this.plugin.settings.showDone;
    const eye = tools.createEl("button", { cls: "todo-planner-eye", title: shown ? "Hide completed TODOs" : "Show completed TODOs" });
    eye.setAttr("aria-pressed", String(shown));
    setIcon(eye, shown ? "eye" : "eye-off");
    eye.onclick = async () => {
      this.plugin.settings.showDone = !shown;
      await this.plugin.saveSettings();
      this.plugin.refreshViews();
    };
    if (done) {
      const box = tools.createEl("button", { cls: "todo-planner-eye", title: `Archive ${done} completed TODO${done === 1 ? "" : "s"}` });
      setIcon(box, "archive");
      box.onclick = () => this.plugin.archiveCompleted();
    }
    const make = tools.createEl("button", { cls: "todo-planner-eye", title: "New list or file" });
    setIcon(make, "folder-plus");
    make.onclick = () => this.plugin.newCategory();
    const tasks = tools.createEl("button", { cls: "todo-planner-eye", title: "Open tasks" });
    setIcon(tasks, "list-checks");
    tasks.onclick = () => this.plugin.openPane(TASKS_VIEW);
  }
  /**
   * Draw the week of the selected day as an agenda: one block per day with its TODOs and
   * a "+" to add one. Overdue TODOs are listed once, on top, when the week contains today.
   * The blocks stack in a narrow pane and form seven columns in a wide one (see styles.css).
   * @param {HTMLElement} el
   * @param {import("./core.js").Todo[]} todos
   * @param {string} today "YYYY-MM-DD"
   * @returns {void}
   */
  drawWeek(el, todos, today) {
    const { showDone, mondayFirst } = this.plugin.settings;
    const keep = (t) => showDone || t.state === "TODO";
    const days = weekDays(this.selected, mondayFirst);
    const { byDay, undated } = groupByDay(todos);
    const withToday = days.includes(today);
    const late = withToday ? todos.filter((t) => isOverdue(t, today)) : [];
    if (late.length) this.section(el, "Overdue", late.filter(keep), today, "is-overdue");
    const grid = el.createDiv({ cls: "todo-planner-weekgrid" });
    for (const key of days) {
      const d = keyDate(key);
      const box = grid.createDiv({ cls: "todo-planner-weekday" });
      if (key === today) box.addClass("is-today");
      if (key === this.selected) box.addClass("is-selected");
      const head = box.createDiv({ cls: "todo-planner-list-head" });
      const name = head.createSpan({ cls: "todo-planner-list-title", text: `${WEEKDAYS[d.getDay()].slice(0, 3)} ${d.getDate()}` });
      name.onclick = () => this.select(key);
      head.createEl("button", { text: "+", title: "New TODO for this day" }).onclick = () => this.plugin.newTodo(key);
      const items = (byDay.get(key) || []).filter((t) => keep(t) && !late.includes(t));
      if (items.length) this.section(box, null, items, today);
    }
    const loose = undated.filter(keep);
    if (loose.length) {
      const box = el.createEl("details", { cls: "todo-planner-undated" });
      box.createEl("summary", { text: `No date (${loose.length})` });
      this.section(box, null, loose, today);
    }
  }
  /**
   * Draw the weekday names and day grid of the month.
   * @param {HTMLElement} el
   * @param {import("./core.js").Todo[]} todos
   * @param {string} today "YYYY-MM-DD"
   * @returns {void}
   */
  drawCalendar(el, todos, today) {
    const sum = daySummary(todos, today);
    const grid = el.createDiv({ cls: "todo-planner-grid" });
    const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    if (!this.plugin.settings.mondayFirst) names.unshift(names.pop());
    names.forEach((n) => grid.createDiv({ cls: "todo-planner-dow", text: n }));
    for (const week of monthGrid(this.year, this.month, this.plugin.settings.mondayFirst)) {
      for (const d of week) {
        if (d === null) { grid.createDiv({ cls: "todo-planner-day is-empty" }); continue; }
        const key = `${this.year}-${pad(this.month + 1)}-${pad(d)}`;
        const cell = grid.createDiv({ cls: "todo-planner-day", text: String(d) });
        if (key === today) cell.addClass("is-today");
        if (key === this.selected) cell.addClass("is-selected");
        const s = sum.get(key);
        if (s) {
          cell.addClass(s.overdue ? "has-overdue" : s.open ? "has-open" : "all-done");
          cell.setAttr("title", `${s.open} open, ${s.done} done`);
          cell.createDiv({ cls: "todo-planner-dot" });
        }
        cell.onclick = () => this.select(key);
        cell.ondblclick = () => this.plugin.newTodo(key);
      }
    }
  }
  /**
   * Draw the selected day's TODOs, with overdue ones first when the day is today, and the
   * undated ones in a collapsible section.
   * @param {HTMLElement} el
   * @param {import("./core.js").Todo[]} todos
   * @param {string} today "YYYY-MM-DD"
   * @returns {void}
   */
  drawList(el, todos, today) {
    const { showDone } = this.plugin.settings;
    const keep = (t) => showDone || t.state === "TODO";
    const { byDay, undated } = groupByDay(todos);
    const head = el.createDiv({ cls: "todo-planner-list-head" });
    const d = keyDate(this.selected);
    head.createSpan({
      cls: "todo-planner-list-title",
      text: `${this.selected === today ? "Today, " : ""}${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`,
    });
    head.createEl("button", { text: "+ TODO" }).onclick = () => this.plugin.newTodo(this.selected);

    if (this.selected === today) {
      const late = todos.filter((t) => isOverdue(t, today));
      if (late.length) this.section(el, "Overdue", late, today, "is-overdue");
    }
    const day = (byDay.get(this.selected) || []).filter(keep);
    if (day.length) this.section(el, null, day, today);
    else el.createDiv({ cls: "todo-planner-empty", text: "Nothing planned for this day." });
    const loose = undated.filter(keep);
    if (loose.length) {
      const box = el.createEl("details", { cls: "todo-planner-undated" });
      box.createEl("summary", { text: `No date (${loose.length})` });
      this.section(box, null, loose, today);
    }
  }
  /**
   * Draw a titled group of TODO rows.
   * @param {HTMLElement} el
   * @param {?string} name section heading, or null for none
   * @param {import("./core.js").Todo[]} items
   * @param {string} today "YYYY-MM-DD"
   * @param {string} [cls] extra class for the section
   * @returns {void}
   */
  section(el, name, items, today, cls = "") {
    const box = el.createDiv({ cls: `todo-planner-section ${cls}` });
    if (name) box.createDiv({ cls: "todo-planner-section-name", text: name });
    for (const t of items) this.row(box, t, today);
  }
  /**
   * Draw one TODO: checkbox, title (opens the file), tags and the due date chip (changes it).
   * @param {HTMLElement} el
   * @param {import("./core.js").Todo} t
   * @param {string} today "YYYY-MM-DD"
   * @returns {void}
   */
  row(el, t, today) {
    const row = el.createDiv({ cls: "todo-planner-row" });
    row.addEventListener("contextmenu", (e) => this.plugin.todoMenu(e, t));
    if (t.state === "DONE") row.addClass("is-done");
    const box = row.createEl("input", { type: "checkbox" });
    box.checked = t.state === "DONE";
    box.onchange = () => this.plugin.toggle(t);
    if (t.virtual) {
      row.addClass("is-virtual");
      row.setAttr("title", `Future occurrence of a repeating TODO (${describeRepeat(t.repeat)}). Tick the next one, on ${t.source.date}.`);
      box.disabled = true;
    }
    const text = row.createSpan({ cls: "todo-planner-text", text: t.title });
    text.onclick = () => this.plugin.goToLine(t.line, t.file);
    if (this.plugin.files().length > 1 && this.plugin.scopedFiles().length > 1) {
      const label = row.createSpan({ cls: "todo-planner-file", text: fileLabel(t.file), title: "Click to move to another file" });
      label.onclick = () => this.plugin.chooseMove(t);
    }
    for (const tag of t.tags) row.createSpan({ cls: "todo-planner-tag", text: `:${tag}:` });
    const chip = row.createEl("button", { cls: "todo-planner-chip", text: t.date ? t.date.slice(5) + (t.repeat ? " ↻" : "") : "+ date" });
    if (isOverdue(t, today)) chip.addClass("is-overdue");
    chip.setAttr("title", t.date ? `Due ${t.date}${t.repeat ? `, repeats ${describeRepeat(t.repeat)}` : ""}: click to change` : "Set a due date");
    if (!t.virtual) chip.onclick = () => this.plugin.changeDue(t);
    this.moreButton(row, t);
  }
  /**
   * Add the ⋯ button that opens the TODO's menu (the same as right-click or long-press).
   * @param {HTMLElement} row
   * @param {import("./main.js").FileTodo} t
   * @returns {void}
   */
  moreButton(row, t) {
    const more = row.createEl("button", { cls: "todo-planner-more", title: "More actions: move, delete..." });
    setIcon(more, "ellipsis");
    more.onclick = (e) => this.plugin.todoMenu(e, t);
  }
}
