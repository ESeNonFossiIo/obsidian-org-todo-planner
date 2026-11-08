// The tasks pane, in the style of Google Tasks: lists as tabs, an "add a task" field, open
// tasks with tick-box sub-items, and the completed ones folded away at the bottom. A list
// is a top-level plain heading of a TODO file; tasks without one are in "Tasks". With
// several TODO files a row of chips picks one file or all of them. A Week mode shows the
// same tasks grouped by day for one week instead of by list. TodoFileView is the same UI bound
// to one file, opened in a tab (for files that ask to open as tasks).
import { ItemView, setIcon } from "obsidian";
import { isOverdue, dayKey, keyDate, addDays, weekDays, weekTitle, projectRepeats, WEEKDAYS, fileLabel, describeRepeat } from "./core.js";

/** Obsidian view type id for the tasks pane. */
export const TASKS_VIEW = "org-todo-planner-tasks";

/** Name shown for the default list, the tasks that sit under no list heading. */
const DEFAULT_LIST = "Tasks";

/**
 * The tasks pane. `all` says whether every list is shown, else `list` is the shown one (null
 * is the default list). `adding` is the key of the task whose "add a sub-item" box is open.
 * In week mode `selected` is a day of the shown week and `addDate` the due date the add row
 * starts with. Which files are shown is the plugin's `scope`.
 */
export class TasksView extends ItemView {
  /**
   * @param {import("obsidian").WorkspaceLeaf} leaf
   * @param {import("./main.js").default} plugin supplies the settings, the TODOs and the actions
   */
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.all = true;
    this.list = null;
    this.adding = null;
    this.selected = dayKey(new Date());
    this.addDate = null;
    this.doneOpen = false;
    this.refocus = null;
    /** Whether the row of file chips is shown (a file-bound view has just one file). */
    this.hasFileChips = true;
  }
  /**
   * @returns {string[]} the TODO files this pane shows: the plugin's scope
   */
  files() { return this.plugin.scopedFiles(); }
  /**
   * @returns {string[]} the files the add-a-task row offers
   */
  addFiles() { return this.plugin.files(); }
  /**
   * @returns {string} the file a new task goes to unless another is picked
   */
  defaultFile() { return this.plugin.defaultFile(); }
  /**
   * @returns {?string} the one file new lists go to, or null to ask when there are several
   */
  fixedFile() { return null; }
  /**
   * @param {string} path a vault path
   * @returns {boolean} whether a change to that file should redraw this pane
   */
  watches(path) { return this.plugin.isTodoFile(path); }
  /**
   * @returns {string} the view type id
   */
  getViewType() { return TASKS_VIEW; }
  /**
   * @returns {string} the tab title
   */
  getDisplayText() { return "Tasks"; }
  /**
   * @returns {string} the tab icon
   */
  getIcon() { return "list-checks"; }
  /**
   * Redraw when a TODO file is saved, then draw for the first time.
   * @returns {Promise<void>}
   */
  async onOpen() {
    this.registerEvent(this.app.vault.on("modify", (f) => {
      if (this.watches(f.path)) this.render();
    }));
    await this.render();
  }
  /**
   * Identity of a task across redraws.
   * @param {import("./main.js").FileTodo} t
   * @returns {string}
   */
  key(t) { return `${t.file}:${t.line}:${t.title}`; }
  /**
   * Rebuild the pane: file chips, the Lists/Week switch, then the lists or the week.
   * @returns {Promise<void>}
   */
  async render() {
    const { todos, names } = await this.plugin.snapshot(this.files());
    const week = this.plugin.settings.tasksMode === "week";
    if (!this.all && this.list !== null && !names.includes(this.list)) this.all = true;
    const today = dayKey(new Date());
    const el = this.contentEl;
    el.empty();
    el.addClass("todo-tasks");
    if (this.hasFileChips) this.drawFiles(el.createDiv({ cls: "todo-tasks-tabs" }));
    this.drawMode(el.createDiv({ cls: "todo-tasks-tabs" }), week);
    if (week) this.drawWeek(el, todos, today);
    else this.drawLists(el, todos, names, today);
    if (this.refocus) {
      const target = el.querySelector(this.refocus);
      if (target) target.focus();
      this.refocus = null;
    }
  }
  /**
   * Draw the Lists / Week switch.
   * @param {HTMLElement} el
   * @param {boolean} week true in week mode
   * @returns {void}
   */
  drawMode(el, week) {
    for (const [mode, label] of [["lists", "Lists"], ["week", "Week"]]) {
      const b = el.createEl("button", { text: label, cls: "todo-tasks-tab" });
      if ((mode === "week") === week) b.addClass("is-active");
      b.onclick = async () => {
        this.plugin.settings.tasksMode = mode;
        await this.plugin.saveSettings();
        this.render();
      };
    }
  }
  /**
   * List mode: the list tabs, the add-a-task row, the open tasks grouped by list (and file),
   * and the completed section.
   * @param {HTMLElement} el
   * @param {import("./main.js").FileTodo[]} todos
   * @param {string[]} names the list names
   * @param {string} today "YYYY-MM-DD"
   * @returns {void}
   */
  drawLists(el, todos, names, today) {
    const files = this.files();
    this.drawTabs(el.createDiv({ cls: "todo-tasks-tabs" }), names);
    this.drawAdd(el.createDiv({ cls: "todo-tasks-add" }));
    const shown = todos.filter((t) => this.all || t.list === this.list);
    const open = shown.filter((t) => t.state === "TODO");
    const lists = this.all ? [null, ...names] : [this.list];
    const several = files.length > 1;
    let any = false;
    for (const file of files) {
      for (const g of lists) {
        const items = open.filter((t) => t.file === file && t.list === g);
        if (!items.length) continue;
        any = true;
        const box = el.createDiv({ cls: "todo-planner-section" });
        this.makeItemTarget(box, file, { list: g });
        const name = this.all ? (g === null ? DEFAULT_LIST : g) : "";
        const head = [name, several ? fileLabel(file) : ""].filter(Boolean).join(" · ");
        const header = head ? box.createDiv({ cls: "todo-planner-section-name", text: head }) : null;
        if (header && this.all && g !== null) this.makeListDnD(header, g, file, false);   // drag a list header to reorder
        for (const t of items) this.drawTask(box, t, today);
      }
    }
    if (!any) el.createDiv({ cls: "todo-planner-empty", text: "No open tasks." });
    if (!names.length) {
      el.createDiv({ cls: "todo-planner-empty", text: "Lists group your tasks, for example Groceries or Work. Create one with + New list." });
    }
    const done = shown.filter((t) => t.state === "DONE");
    if (done.length && this.plugin.settings.showDone) this.drawDone(el, done, several);
  }
  /**
   * Week mode: previous/next/Today, the add-a-task row and the week of the selected day, one
   * block per day with a "+" that starts a task for that day. Overdue tasks come first (when the
   * week contains today) and are not repeated under their days; later occurrences of repeating
   * tasks are shown read-only; tasks without a date are folded at the bottom.
   * @param {HTMLElement} el
   * @param {import("./main.js").FileTodo[]} todos
   * @param {string} today "YYYY-MM-DD"
   * @returns {void}
   */
  drawWeek(el, todos, today) {
    const { mondayFirst, showDone } = this.plugin.settings;
    const days = weekDays(this.selected, mondayFirst);
    const nav = el.createDiv({ cls: "todo-tasks-tabs todo-tasks-weeknav" });
    nav.createEl("button", { text: "‹" }).onclick = () => this.select(addDays(this.selected, -7));
    nav.createSpan({ cls: "todo-planner-title", text: weekTitle(days) });
    nav.createEl("button", { text: "›" }).onclick = () => this.select(addDays(this.selected, 7));
    nav.createEl("button", { text: "Today" }).onclick = () => this.select(today);
    this.drawAdd(el.createDiv({ cls: "todo-tasks-add" }));

    const all = todos.concat(projectRepeats(todos, days[0], days[6], today));
    const keep = (t) => showDone || t.state === "TODO";
    const late = days.includes(today) ? todos.filter((t) => isOverdue(t, today)) : [];
    if (late.length) {
      const box = el.createDiv({ cls: "todo-planner-section is-overdue" });
      box.createDiv({ cls: "todo-planner-section-name", text: "Overdue" });
      for (const t of late) this.drawTask(box, t, today, true);
    }
    for (const key of days) {
      const d = keyDate(key);
      const box = el.createDiv({ cls: "todo-planner-weekday" });
      this.makeItemTarget(box, null, { due: key });   // drop a sub-item here to make it a task due that day
      if (key === today) box.addClass("is-today");
      if (key === this.selected) box.addClass("is-selected");
      const head = box.createDiv({ cls: "todo-planner-list-head" });
      head.createSpan({ cls: "todo-planner-list-title", text: `${WEEKDAYS[d.getDay()].slice(0, 3)} ${d.getDate()}` }).onclick = () => this.select(key);
      head.createEl("button", { text: "+", title: "Add a task for this day" }).onclick = () => {
        this.addDate = key;
        this.refocus = ".todo-tasks-add-title";
        this.render();
      };
      const items = all.filter((t) => t.date === key && !late.includes(t) && keep(t));
      for (const t of items.filter((x) => x.state === "TODO")) this.drawTask(box, t, today, true);
      for (const t of items.filter((x) => x.state === "DONE")) this.doneRow(box, t);
    }
    const loose = todos.filter((t) => !t.date && keep(t));
    if (loose.length) {
      const box = el.createEl("details", { cls: "todo-planner-undated" });
      box.createEl("summary", { text: `No date (${loose.length})` });
      for (const t of loose) {
        if (t.state === "TODO") this.drawTask(box, t, today, true);
        else this.doneRow(box, t);
      }
    }
  }
  /**
   * Show a day (and its week) in week mode.
   * @param {string} key "YYYY-MM-DD"
   * @returns {void}
   */
  select(key) {
    this.selected = key;
    this.render();
  }
  /**
   * Draw the file chips (All files, then one per TODO file, when there are several; they set the
   * plugin's scope) and the "+ New file" button.
   * @param {HTMLElement} el
   * @returns {void}
   */
  drawFiles(el) {
    const current = this.plugin.scopedFiles().length === 1 ? this.plugin.scopedFiles()[0] : null;
    const chip = (label, path) => {
      const b = el.createEl("button", { text: label, cls: "todo-tasks-tab todo-tasks-file" });
      if (path === current) b.addClass("is-active");
      b.onclick = () => this.plugin.setScope(path);
    };
    if (this.plugin.files().length > 1) {
      chip("All files", null);
      for (const f of this.plugin.files()) chip(fileLabel(f), f);
    }
    el.createEl("button", { text: "+ New file", cls: "todo-tasks-tab todo-tasks-new", title: "Create another TODO file, e.g. things_to_buy or work" })
      .onclick = () => this.plugin.newFile();
  }
  /**
   * Draw the list tabs: All, the default list, each named list and the "+ New list" button.
   * @param {HTMLElement} el
   * @param {string[]} names
   * @returns {void}
   */
  drawTabs(el, names) {
    const tab = (label, on, go, target) => {
      const b = el.createEl("button", { text: label, cls: "todo-tasks-tab" });
      if (on) b.addClass("is-active");
      b.onclick = () => { go(); this.render(); };
      if (target) this.makeItemTarget(b, null, target);   // drop a sub-item here to make it a task of that list
      return b;
    };
    tab("All", this.all, () => { this.all = true; });
    tab(DEFAULT_LIST, !this.all && this.list === null, () => { this.all = false; this.list = null; }, { list: null });
    for (const n of names) {
      const b = tab(n, !this.all && this.list === n, () => { this.all = false; this.list = n; }, { list: n });
      this.makeListDnD(b, n, null, true);   // drag a list tab onto another to reorder the lists
    }
    el.createEl("button", { text: "+ New list", cls: "todo-tasks-tab todo-tasks-new", title: "Create a new list, e.g. Groceries" })
      .onclick = () => this.plugin.newList(this.fixedFile());
    if (!this.all && this.list !== null) {
      for (const [dir, icon, label] of [[-1, "arrow-left", "Move list left"], [1, "arrow-right", "Move list right"]]) {
        const move = el.createEl("button", { cls: "todo-tasks-tab", title: `${label}: "${this.list}"` });
        setIcon(move, icon);
        move.onclick = () => this.plugin.moveListStep(this.list, dir, this.files());
      }
      el.createEl("button", { text: "Rename list", cls: "todo-tasks-tab", title: `Rename the list "${this.list}"` })
        .onclick = () => this.plugin.renameList(this.list, this.files());
      el.createEl("button", { text: "Delete list", cls: "todo-tasks-tab todo-tasks-danger", title: `Delete the list "${this.list}" and its tasks` })
        .onclick = () => this.plugin.deleteList(this.list, this.files());
    }
  }
  /**
   * Draw the "Add a task" row: text, optional due date, the file (if there are several) and
   * the button. Enter adds too.
   * @param {HTMLElement} el
   * @returns {void}
   */
  drawAdd(el) {
    const input = el.createEl("input", { type: "text", placeholder: "Add a task", cls: "todo-tasks-add-title" });
    const date = el.createEl("input", { type: "date", title: "Due date" });
    date.value = this.addDate || "";
    const files = this.addFiles();
    let pick = null;
    if (files.length > 1) {
      el.addClass("has-file");
      pick = el.createEl("select", { cls: "dropdown", title: "File" });
      for (const f of files) pick.createEl("option", { text: fileLabel(f) }).value = f;
      pick.value = this.defaultFile();
    }
    const submit = async () => {
      const title = input.value.trim();
      if (!title) return;
      this.refocus = ".todo-tasks-add-title";
      this.addDate = null;
      const week = this.plugin.settings.tasksMode === "week";
      await this.plugin.addTask({ title, due: date.value || null, list: week || this.all ? null : this.list, file: pick ? pick.value : this.defaultFile() });
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
    el.createEl("button", { text: "Add" }).onclick = submit;
  }
  /**
   * Draw one open task: tick box, title, progress, due chip and "add sub-item", then its
   * checkbox items and, if open, the box to add another. A projected future occurrence of a
   * repeating task (`t.virtual`) is drawn read-only, without items.
   * @param {HTMLElement} el
   * @param {import("./main.js").FileTodo} t
   * @param {string} today "YYYY-MM-DD"
   * @param {boolean} [context=false] also show the task's list and file (week mode, where tasks
   *   are not grouped by list)
   * @returns {void}
   */
  drawTask(el, t, today, context = false) {
    const task = el.createDiv({ cls: "todo-tasks-task" });
    if (!t.virtual) this.makeDraggable(task, t);
    const row = task.createDiv({ cls: "todo-planner-row" });
    row.addEventListener("contextmenu", (e) => this.plugin.todoMenu(e, t));
    const box = row.createEl("input", { type: "checkbox" });
    box.onchange = () => this.plugin.toggle(t);
    if (t.virtual) {
      row.addClass("is-virtual");
      row.setAttr("title", `Future occurrence of a repeating TODO (${describeRepeat(t.repeat)}). Tick the next one, on ${t.source.date}.`);
      box.disabled = true;
    }
    row.createSpan({ cls: "todo-planner-text", text: t.title }).onclick = () => this.plugin.goToLine(t.line, t.file);
    for (const tag of t.tags) row.createSpan({ cls: "todo-planner-tag", text: `:${tag}:` });
    if (context && t.list) row.createSpan({ cls: "todo-planner-file", text: t.list });
    if (context && this.files().length > 1) {
      row.createSpan({ cls: "todo-planner-file", text: fileLabel(t.file), title: "Click to move to another file" }).onclick = () => this.plugin.chooseMove(t);
    }
    if (t.items.length && !t.virtual) {
      row.createSpan({ cls: "todo-tasks-progress", text: `${t.items.filter((i) => i.checked).length}/${t.items.length}` });
    }
    if (t.date) {
      const chip = row.createEl("button", {
        cls: "todo-planner-chip", text: t.date.slice(5) + (t.repeat ? " ↻" : ""),
        title: `Due ${t.date}${t.repeat ? `, repeats ${describeRepeat(t.repeat)}` : ""}: click to change`,
      });
      if (isOverdue(t, today)) chip.addClass("is-overdue");
      if (!t.virtual) chip.onclick = () => this.plugin.changeDue(t);
    }
    if (t.virtual) return;
    const plus = row.createEl("button", { cls: "todo-tasks-plus", title: "Add a sub-item" });
    setIcon(plus, "list-plus");
    const more = row.createEl("button", { cls: "todo-tasks-plus", title: "More actions: move, delete..." });
    setIcon(more, "ellipsis");
    more.onclick = (e) => this.plugin.todoMenu(e, t);
    plus.onclick = () => { this.adding = this.adding === this.key(t) ? null : this.key(t); this.refocus = ".todo-tasks-sub-input"; this.render(); };
    for (const item of t.items) {
      const r = task.createDiv({ cls: "todo-tasks-item" });
      if (item.checked) r.addClass("is-done");
      const c = r.createEl("input", { type: "checkbox" });
      c.checked = item.checked;
      c.onchange = () => this.plugin.toggleItem(t, item);
      r.createSpan({ cls: "todo-planner-text", text: item.text });
      this.makeItemDraggable(r, t, item);
      const up = r.createEl("button", { cls: "todo-planner-more", title: "Make it a task" });
      setIcon(up, "arrow-up-right");
      up.onclick = () => this.plugin.promoteItem(t, item);
      const del = r.createEl("button", { cls: "todo-planner-more", title: "Delete sub-item" });
      setIcon(del, "x");
      del.onclick = () => this.plugin.deleteItem(t, item);
    }
    if (this.adding === this.key(t)) {
      const r = task.createDiv({ cls: "todo-tasks-item" });
      const input = r.createEl("input", { type: "text", placeholder: "Add a sub-item", cls: "todo-tasks-sub-input" });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { this.adding = null; this.render(); return; }
        if (e.key !== "Enter") return;
        e.preventDefault();
        const label = input.value.trim();
        if (!label) return;
        this.refocus = ".todo-tasks-sub-input";
        this.plugin.addItem(t, label);
      });
    }
  }
  /**
   * Draw the folded "Completed" section.
   * @param {HTMLElement} el
   * @param {import("./main.js").FileTodo[]} done
   * @param {boolean} several true if several files are shown (adds each task's file name)
   * @returns {void}
   */
  drawDone(el, done, several) {
    const box = el.createEl("details", { cls: "todo-tasks-done" });
    box.open = this.doneOpen;
    box.addEventListener("toggle", () => { this.doneOpen = box.open; });
    box.createEl("summary", { text: `Completed (${done.length})` });
    for (const t of done) this.doneRow(box, t, several);
  }
  /**
   * Let a task be dragged onto another task of the same file: near the top or bottom edge of the
   * other task it is placed before or after it (a line shows where); in the middle it becomes a
   * sub-item of it. The block is the drag source and also a drop target while another task is
   * dragged over it. (Touch screens do not drag; the task's menu has "Move up", "Move down" and
   * "Make a sub-item of...".)
   * @param {HTMLElement} block the task's element
   * @param {import("./main.js").FileTodo} t
   * @returns {void}
   */
  makeDraggable(block, t) {
    const plugin = this.plugin;
    const reorder = plugin.settings.tasksMode !== "week";   // in week mode the order of the file is not visible
    const valid = () => plugin.dragged && plugin.dragged !== t && plugin.dragged.file === t.file;
    const clear = () => block.classList.remove("is-drop-target", "is-drop-before", "is-drop-after");
    // near the top or bottom edge: place it before / after this task; in the middle: make it a sub-item
    const zoneAt = (e) => {
      if (!reorder) return "nest";
      const r = block.getBoundingClientRect();
      const edge = Math.min(12, r.height * 0.3);
      return e.clientY < r.top + edge ? "before" : e.clientY > r.bottom - edge ? "after" : "nest";
    };
    block.draggable = true;
    block.addEventListener("dragstart", (e) => {
      plugin.dragged = t;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", t.title);
      block.addClass("is-dragging");
    });
    block.addEventListener("dragend", () => {
      plugin.dragged = null;
      block.removeClass("is-dragging");
      this.contentEl.querySelectorAll(".is-drop-target, .is-drop-before, .is-drop-after").forEach((x) => x.classList.remove("is-drop-target", "is-drop-before", "is-drop-after"));
    });
    block.addEventListener("dragover", (e) => {
      if (plugin.dragged === t) {   // over itself: nowhere to drop, and not the list section around it either
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "none";
        return;
      }
      if (!valid()) return;
      e.preventDefault();
      e.stopPropagation();   // not the list section around it
      e.dataTransfer.dropEffect = "move";
      clear();
      const zone = zoneAt(e);
      block.addClass(zone === "nest" ? "is-drop-target" : `is-drop-${zone}`);
    });
    block.addEventListener("dragleave", (e) => {
      if (!block.contains(e.relatedTarget)) clear();
    });
    block.addEventListener("drop", (e) => {
      if (plugin.dragged === t) {   // dropped back on itself: nothing to do, and not the list section's move
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (!valid()) return;
      e.preventDefault();
      e.stopPropagation();
      const zone = zoneAt(e);
      const src = plugin.dragged;
      plugin.dragged = null;
      clear();
      if (zone === "nest") plugin.nestTask(src, t);
      else plugin.reorderTask(src, t, zone);
    });
  }
  /**
   * Let a list be dragged, by its tab or its section header, and dropped on another list to be
   * placed before or after it (a line shows where; the first or second half of the other element
   * decides). Tabs reorder the lists in every file that has both; a header only in its own file.
   * @param {HTMLElement} el the tab or header
   * @param {string} name the list's name
   * @param {?string} file the header's file, or null for a tab
   * @param {boolean} horizontal true for tabs (left/right halves), false for headers (top/bottom)
   * @returns {void}
   */
  makeListDnD(el, name, file, horizontal) {
    const plugin = this.plugin;
    const drag = () => plugin.draggedList;
    const valid = () => drag() && drag().name !== name && (file === null || drag().file === null || drag().file === file);
    const clear = () => el.classList.remove("is-drop-before", "is-drop-after");
    const zone = (e) => {
      const r = el.getBoundingClientRect();
      return (horizontal ? e.clientX < r.left + r.width / 2 : e.clientY < r.top + r.height / 2) ? "before" : "after";
    };
    el.draggable = true;
    el.addEventListener("dragstart", (e) => {
      e.stopPropagation();
      plugin.draggedList = { name, file };
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", name);
      el.addClass("is-dragging");
    });
    el.addEventListener("dragend", () => {
      plugin.draggedList = null;
      el.removeClass("is-dragging");
      this.contentEl.querySelectorAll(".is-drop-before, .is-drop-after").forEach((x) => x.classList.remove("is-drop-before", "is-drop-after"));
    });
    el.addEventListener("dragover", (e) => {
      if (!valid()) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      clear();
      el.addClass(`is-drop-${zone(e)}`);
    });
    el.addEventListener("dragleave", (e) => {
      if (!el.contains(e.relatedTarget)) clear();
    });
    el.addEventListener("drop", (e) => {
      if (!valid()) return;
      e.preventDefault();
      e.stopPropagation();
      const where = zone(e);
      const { name: moved } = drag();
      plugin.draggedList = null;
      clear();
      plugin.reorderList(moved, name, where, file === null ? this.files() : [file]);
    });
  }
  /**
   * Let a sub-item be dragged out: onto a list (tab or section) to become a task of it, or, in week
   * mode, onto a day to become a task due then. Right-click / long-press opens its menu.
   * @param {HTMLElement} row the sub-item's element
   * @param {import("./main.js").FileTodo} t the task it belongs to
   * @param {{line: number, text: string}} item
   * @returns {void}
   */
  makeItemDraggable(row, t, item) {
    const plugin = this.plugin;
    row.draggable = true;
    row.addEventListener("contextmenu", (e) => { e.stopPropagation(); plugin.itemMenu(e, t, item); });
    row.addEventListener("dragstart", (e) => {
      e.stopPropagation();   // not the task's own drag (see makeDraggable)
      plugin.draggedItem = { t, item };
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", item.text);
      row.addClass("is-dragging");
    });
    row.addEventListener("dragend", (e) => {
      e.stopPropagation();
      plugin.draggedItem = null;
      row.removeClass("is-dragging");
      this.contentEl.querySelectorAll(".is-drop-target").forEach((x) => x.removeClass("is-drop-target"));
    });
  }
  /**
   * Make an element accept a dragged sub-item, which becomes a task as `target` says, or a dragged
   * task, which moves to the end of `target.list` or, for `target.due`, gets that due date.
   * @param {HTMLElement} el the drop target
   * @param {?string} file only sub-items and tasks of this file are accepted; null accepts any (the
   *   change is made in their own file)
   * @param {{list?: ?string, due?: ?string}} target see `promoteItem` in main.js
   * @returns {void}
   */
  makeItemTarget(el, file, target) {
    const plugin = this.plugin;
    const item = () => plugin.draggedItem && (file === null || plugin.draggedItem.t.file === file);
    const task = () => plugin.dragged && (file === null || plugin.dragged.file === file);
    el.addEventListener("dragover", (e) => {
      if (!item() && !task()) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      el.addClass("is-drop-target");
    });
    el.addEventListener("dragleave", (e) => {
      if (!el.contains(e.relatedTarget)) el.removeClass("is-drop-target");
    });
    el.addEventListener("drop", (e) => {
      const isItem = item();
      if (!isItem && !task()) return;
      e.preventDefault();
      e.stopPropagation();
      el.removeClass("is-drop-target");
      if (isItem) {
        const { t, item: it } = plugin.draggedItem;
        plugin.draggedItem = null;
        plugin.promoteItem(t, it, target);
      } else {
        const src = plugin.dragged;
        plugin.dragged = null;
        if (target.due) plugin.rescheduleTask(src, target.due);
        else if (target.list !== undefined) plugin.moveTaskToList(src, target.list);
      }
    });
  }
  /**
   * Draw one completed task: a ticked box (untick to reopen), its title and, if asked, its file.
   * @param {HTMLElement} el
   * @param {import("./main.js").FileTodo} t
   * @param {boolean} [several] true to add the task's file name (default: when several files are shown)
   * @returns {void}
   */
  doneRow(el, t, several = this.files().length > 1) {
    const row = el.createDiv({ cls: "todo-planner-row is-done" });
    row.addEventListener("contextmenu", (e) => this.plugin.todoMenu(e, t));
    const c = row.createEl("input", { type: "checkbox" });
    c.checked = true;
    c.onchange = () => this.plugin.toggle(t);
    row.createSpan({ cls: "todo-planner-text", text: t.title }).onclick = () => this.plugin.goToLine(t.line, t.file);
    if (several) {
      const label = row.createSpan({ cls: "todo-planner-file", text: fileLabel(t.file), title: "Click to move to another file" });
      label.onclick = () => this.plugin.chooseMove(t);
    }
  }
}

/** Obsidian view type id for the file-bound tasks view. */
export const FILE_VIEW = "org-todo-planner-file";

/**
 * The tasks UI bound to one TODO file and opened in a tab, for a file that asks to be opened as
 * tasks (a `#+PLANNER:` header line or a task folder). Its state is the file's path, so Obsidian
 * restores it. The "Edit as text" action in its header opens the file in the Org editor instead.
 */
export class TodoFileView extends TasksView {
  /**
   * @param {import("obsidian").WorkspaceLeaf} leaf
   * @param {import("./main.js").default} plugin
   */
  constructor(leaf, plugin) {
    super(leaf, plugin);
    /** Vault path of the file, set by `setState`. */
    this.path = null;
    this.hasFileChips = false;
  }
  /**
   * @returns {string} the view type id
   */
  getViewType() { return FILE_VIEW; }
  /**
   * @returns {string} the tab title: the file's name without the extension
   */
  getDisplayText() { return this.path ? fileLabel(this.path) : "TODO file"; }
  /**
   * @returns {{file: ?string}} what Obsidian saves to restore the tab
   */
  getState() { return { file: this.path }; }
  /**
   * Show the file given in the state.
   * @param {{file?: string}} state
   * @param {object} result
   * @returns {Promise<void>}
   */
  async setState(state, result) {
    if (state && state.file) this.path = state.file;
    await super.setState(state, result);
    await this.render();
  }
  /**
   * @returns {string[]} just this view's file
   */
  files() { return this.path ? [this.path] : []; }
  /**
   * @returns {string[]} just this view's file (so the add row has no file picker)
   */
  addFiles() { return this.files(); }
  /**
   * @returns {string} this view's file
   */
  defaultFile() { return this.path; }
  /**
   * @returns {?string} this view's file: new lists go into it
   */
  fixedFile() { return this.path; }
  /**
   * @param {string} path
   * @returns {boolean} whether it is this view's file
   */
  watches(path) { return path === this.path; }
  /**
   * Add the "Edit as text" action, then draw.
   * @returns {Promise<void>}
   */
  async onOpen() {
    this.contentEl.addClass("is-file");
    this.addAction("file-text", "Edit as text", () => this.plugin.editAsText(this));
    await super.onOpen();
  }
  /**
   * Draw the tasks, with a notice on top if the file is not one of the TODO files (so the planner
   * does not show its tasks) and a button to add it.
   * @returns {Promise<void>}
   */
  async render() {
    await super.render();
    if (!this.path || this.plugin.isTodoFile(this.path)) return;
    const bar = this.contentEl.createDiv({ cls: "todo-tasks-banner" });
    bar.createSpan({ text: "This file is not in your TODO files, so the planner and the Tasks pane do not show it." });
    bar.createEl("button", { text: "Add to TODO files" }).onclick = () => this.plugin.registerFile(this.path);
    this.contentEl.prepend(bar);
  }
}
