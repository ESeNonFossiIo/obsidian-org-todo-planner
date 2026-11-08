/*
 * Org Todo Planner -- day-by-day TODOs in Org files, with a calendar and due dates.
 *
 * File layout (plain Org, so Emacs can read it too):
 *
 *   * TODO Pay the rent                                          :home:
 *     DEADLINE: <2026-11-10 Tue>
 *   * DONE Call mum
 *     CLOSED: [2026-11-07 Sat 10:12] DEADLINE: <2026-11-07 Sat>
 *
 * There can be several TODO files (home.org, work.org...); both panes show them together
 * or one at a time (`scope`). Works alongside the Org Reader plugin, which provides the
 * `.org` editor view (view type "org-reader", whose `codeMirror` property is the CodeMirror
 * EditorView). If a file is open in that view, edits go through its CodeMirror so nothing
 * is clobbered by a background file write; otherwise the file is changed through the vault.
 * No Node APIs, so it runs on mobile too.
 *
 * This file is the plugin entry point: commands, ribbon icons, settings and the glue
 * between Obsidian and the pure logic in core.js. Other modules:
 *   core.js      parsing/editing of TODOs, dates, month grid (unit-tested)
 *   planner.js   the calendar + day list pane
 *   tasks.js     the lists pane
 *   modals.js    new-TODO, due-date and other dialogs
 *   settings.js  settings tab (defaults in settings-defaults.js)
 */
import { Plugin, ItemView, Menu, Notice, Platform, TFile, TFolder, normalizePath } from "obsidian";
import { EditorView } from "@codemirror/view";
import { parseTodos, listNames, addTodo, addList, toggleItem, addItem, setState, completeTodo, setDue, archiveDone, archivePath, moveTodo, deleteTodo, deleteItem, deleteList, renameTodo, renameList, isListName, orgPath, plannerSetting, addPlannerMarker, inTaskFolder, nestTodo, todoSubtree, promoteItem, reorderTodo, moveTodoToList, siblingTodo, reorderList, fileLabel, dayKey } from "./core.js";
import { PlannerView, PLANNER_VIEW } from "./planner.js";
import { TasksView, TASKS_VIEW, TodoFileView, FILE_VIEW } from "./tasks.js";
import { TodoModal, DueModal, ConfirmModal, FilePickerModal, PromptModal, TaskPickerModal, CategoryModal } from "./modals.js";
import { TodoPlannerSettings } from "./settings.js";
import { DEFAULTS } from "./settings-defaults.js";

/** View type of Org Reader's `.org` view. */
const ORG_VIEW = "org-reader";

/**
 * A TODO as the panes see it: the parsed TODO plus the file it is in.
 * @typedef {import("./core.js").Todo & {file: string}} FileTodo
 */

export default class TodoPlannerPlugin extends Plugin {
  /**
   * Register the planner view, ribbon icons, commands and the settings tab.
   * @returns {Promise<void>}
   */
  async onload() {
    await this.loadSettings();
    /** Path of the one file the panes are limited to, or null for all files (not saved). */
    this.scope = null;
    /** Leaves where the user chose the text editor for a file, so it is not switched to tasks again. */
    this.rawLeaves = new WeakMap();
    /** Org tabs that were checked and should stay text, by leaf (the value is the file's path). */
    this.stayText = new WeakMap();
    /** The task being dragged in a tasks pane (shared, so a drag can cross panes). */
    this.dragged = null;
    /** The sub-item being dragged: `{t, item}` (the task it belongs to and the item). */
    this.draggedItem = null;
    /** The list being dragged: `{name, file}` (`file` is null when it comes from a tab). */
    this.draggedList = null;
    this.registerView(PLANNER_VIEW, (leaf) => new PlannerView(leaf, this));
    this.registerView(TASKS_VIEW, (leaf) => new TasksView(leaf, this));
    this.registerView(FILE_VIEW, (leaf) => new TodoFileView(leaf, this));
    this.addRibbonIcon("calendar-check", "Todo planner", () => this.openPlanner());
    this.addRibbonIcon("list-checks", "Tasks", () => this.openPane(TASKS_VIEW));
    this.addRibbonIcon("plus-circle", "New TODO", () => this.newTodo());
    this.addRibbonIcon("folder-plus", "New list or file", () => this.newCategory());
    this.addCommand({ id: "open-planner", name: "Open planner", callback: () => this.openPlanner() });
    this.addCommand({ id: "open-tasks", name: "Open tasks", callback: () => this.openPane(TASKS_VIEW) });
    this.addCommand({ id: "new-todo", name: "New TODO", callback: () => this.newTodo() });
    this.addCommand({ id: "new-category", name: "New list or file", callback: () => this.newCategory() });
    this.addCommand({ id: "new-list", name: "New list", callback: () => this.newList() });
    this.addCommand({ id: "open-file-as-tasks", name: "Open TODO file as tasks", callback: () => this.openFileAs(true) });
    this.addCommand({ id: "explain-open", name: "Why does this file open as text? (diagnose)", callback: () => this.explainOpen() });
    this.addCommand({
      id: "mark-as-tasks", name: "Make this file open as tasks",
      checkCallback: (check) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || !/\.org$/i.test(file.path)) return false;
        if (!check) this.markAsTasks(file.path);
        return true;
      },
    });
    this.addCommand({ id: "new-file", name: "New TODO file", callback: () => this.newFile() });
    this.addCommand({ id: "open-file", name: "Open TODO file", callback: () => this.openFile() });
    this.addCommand({ id: "archive-completed", name: "Archive completed TODOs", callback: () => this.archiveCompleted() });
    this.addCommand({
      id: "toggle-at-cursor", name: "Toggle TODO under cursor",
      checkCallback: (check) => this.atCursor(check, (t) => this.toggle(t)),
    });
    this.addCommand({
      id: "move-at-cursor", name: "Move TODO under cursor to another file",
      checkCallback: (check) => this.files().length > 1 && this.atCursor(check, (t) => this.chooseMove(t)),
    });
    this.addCommand({
      id: "rename-at-cursor", name: "Rename TODO under cursor",
      checkCallback: (check) => this.atCursor(check, (t) => this.renameTask(t)),
    });
    this.addCommand({
      id: "delete-at-cursor", name: "Delete TODO under cursor",
      checkCallback: (check) => this.atCursor(check, (t) => this.deleteTask(t)),
    });
    this.addCommand({
      id: "due-at-cursor", name: "Set due date of TODO under cursor",
      checkCallback: (check) => this.atCursor(check, (t) => this.changeDue(t)),
    });
    this.addSettingTab(new TodoPlannerSettings(this.app, this));
    this.registerEvent(this.app.workspace.on("file-open", () => this.sweepSoon()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.sweepSoon()));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.sweepSoon()));
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
      if (!(file instanceof TFile) || !/\.org$/i.test(file.path)) return;
      menu.addItem((i) => i.setTitle("Open as tasks").setIcon("list-checks").onClick(() => this.openAsTasks(file.path)));
    }));
    this.app.workspace.onLayoutReady(() => {
      this.sweepSoon();   // tabs that were already open when the plugin loaded
      // the folders' contents change with the vault; not listened to during start-up, when every file "is created"
      const changed = (file, oldPath) => {
        // only files that are, or were, TODO files matter; other vault events are ignored
        const folders = this.settings.taskFolders || [];
        const relevant = (path) => !!path && /\.org$/i.test(path) && (inTaskFolder(path, folders) || this.isTodoFile(path));
        if (!relevant(file.path) && !relevant(oldPath)) return;
        this.invalidateFiles();
        clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => this.refreshViews(), 150);
      };
      for (const event of ["create", "delete", "rename"]) this.registerEvent(this.app.vault.on(event, changed));
    });
  }

  /**
   * Stop a pending redraw.
   * @returns {void}
   */
  onunload() {
    clearTimeout(this.refreshTimer);
    clearTimeout(this.sweepTimer);
  }

  /**
   * Load the saved settings over the defaults. An old single `file` setting becomes the
   * one-entry `files` list.
   * @returns {Promise<void>}
   */
  async loadSettings() {
    const saved = (await this.loadData()) || {};
    this.settings = Object.assign({}, DEFAULTS, saved);
    if (!Array.isArray(saved.files)) this.settings.files = saved.file ? [saved.file] : DEFAULTS.files.slice();
    delete this.settings.file;
    if (!Array.isArray(this.settings.taskFolders)) this.settings.taskFolders = [];
  }

  /**
   * Save the settings.
   * @returns {Promise<void>}
   */
  saveSettings() { return this.saveData(this.settings); }

  /**
   * Whether the Org Reader plugin (which provides the .org editor view) is enabled.
   * Assumes yes if Obsidian's internal plugin list is not available.
   * @returns {boolean}
   */
  hasOrgReader() {
    const p = this.app.plugins;
    return !p || !p.enabledPlugins || p.enabledPlugins.has("org-reader");
  }

  /**
   * The TODO files (vault paths), never empty: the ones listed in the settings, then every `.org`
   * file (archives excepted) below a task folder. The list is cached until the settings it depends
   * on change or `invalidateFiles` is called (the vault's files changed).
   * @returns {string[]}
   */
  files() {
    const key = JSON.stringify([this.settings.files, this.settings.taskFolders]);
    if (this._files && this._filesKey === key) return this._files;
    const configured = [...new Set((this.settings.files || []).map((f) => normalizePath(f)).filter(Boolean))];
    const folders = this.settings.taskFolders || [];
    const found = this.filesInTaskFolders(folders);
    const all = [...new Set([...configured, ...found])];
    this._files = all.length ? all : DEFAULTS.files.slice();
    this._filesKey = key;
    return this._files;
  }

  /**
   * The `.org` files (archives excepted) below the task folders. Only those folders are walked, from
   * the folder object down: the rest of the vault is never listed. An empty entry, or `/` (the whole
   * vault), is ignored.
   * @param {string[]} folders vault folders from the settings
   * @returns {string[]} their paths, sorted
   */
  filesInTaskFolders(folders) {
    const found = [];
    for (const raw of folders) {
      const dir = raw.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");   // same cleaning as inTaskFolder
      if (!dir || dir === ".") continue;
      const root = this.app.vault.getAbstractFileByPath(normalizePath(dir));
      if (!(root instanceof TFolder)) continue;
      const walk = (folder) => {
        for (const child of folder.children) {
          if (child instanceof TFolder) walk(child);
          else if (inTaskFolder(child.path, [dir])) found.push(child.path);
        }
      };
      walk(root);
    }
    return [...new Set(found)].sort();
  }

  /**
   * Forget the cached TODO file list (after the settings or the vault's files changed).
   * @returns {void}
   */
  invalidateFiles() { this._files = null; }

  /**
   * The list of TODO files changed: recompute it and redraw the panes.
   * @returns {void}
   */
  filesChanged() {
    this.invalidateFiles();
    this.refreshViews();
    this.recheckLeaves();
  }

  /**
   * @param {string} path
   * @returns {boolean} whether it is one of the TODO files
   */
  isTodoFile(path) { return this.files().includes(path); }

  /**
   * @returns {string[]} the files the panes currently show: the scope file, or all of them
   */
  scopedFiles() {
    const all = this.files();
    return this.scope && all.includes(this.scope) ? [this.scope] : all;
  }

  /**
   * @returns {string} where new TODOs go unless told otherwise: the scope file, else the first
   */
  defaultFile() { return this.scopedFiles()[0]; }

  /**
   * Limit the panes to one file, or to all of them, and redraw.
   * @param {?string} path a TODO file, or null for all
   * @returns {void}
   */
  setScope(path) {
    this.scope = path;
    this.refreshViews();
  }

  /**
   * @param {string} path a vault path
   * @returns {?TFile} the file, or null if it does not exist (yet)
   */
  fileAt(path) {
    const f = this.app.vault.getAbstractFileByPath(path);
    return f instanceof TFile ? f : null;
  }

  /**
   * The editor of a TODO file if it is open in Org Reader.
   * @param {string} path
   * @returns {?import("@codemirror/view").EditorView}
   */
  liveEditor(path) {
    const leaf = this.app.workspace.getLeavesOfType(ORG_VIEW).find((l) => l.view.file && l.view.file.path === path);
    return (leaf && leaf.view.codeMirror) || null;
  }

  /**
   * Current text of a TODO file: from the live editor if there is one, else from the vault.
   * @param {string} path
   * @returns {Promise<string>} empty if the file does not exist yet
   */
  async text(path) {
    const file = this.fileAt(path);
    if (!file) return "";
    // The editor's doc is empty until Org Reader has loaded the file (e.g. right after
    // startup), so only trust it when it has content.
    const live = this.liveEditor(path);
    return (live && live.state.doc.toString()) || this.app.vault.cachedRead(file);
  }

  /**
   * What the panes draw: the TODOs of the files in scope (in file order, each tagged with its
   * file) and the list names found there.
   * @param {string[]} [files] the files to read; defaults to the files in scope
   * @returns {Promise<{todos: FileTodo[], names: string[]}>}
   */
  async snapshot(files = this.scopedFiles()) {
    const todos = [];
    const names = [];
    for (const file of files) {
      const text = await this.text(file);
      for (const t of parseTodos(text)) todos.push(Object.assign(t, { file }));
      for (const n of listNames(text)) if (!names.includes(n)) names.push(n);
    }
    return { todos, names };
  }

  /**
   * The loaded panes of a view type. Obsidian keeps tabs that have not been shown yet (for
   * example the second tab of a sidebar, after a restart) as placeholders whose `view` has no
   * `render`; those draw themselves when they are shown, so they are left out.
   * @param {string} type PLANNER_VIEW, TASKS_VIEW or FILE_VIEW
   * @returns {Array<PlannerView|TasksView>}
   */
  panes(type) {
    return this.app.workspace.getLeavesOfType(type).map((l) => l.view).filter((v) => v && typeof v.render === "function");
  }

  /**
   * Redraw the open planner and tasks panes.
   * @returns {void}
   */
  refreshViews() {
    for (const type of [PLANNER_VIEW, TASKS_VIEW, FILE_VIEW]) {
      for (const view of this.panes(type)) view.render();
    }
  }

  /**
   * Change a TODO file's text, creating the file if needed, then redraw the panes. In the
   * editor only the changed middle part is dispatched, so folds, scroll position and undo
   * history survive; without an editor it writes through `vault.process`.
   * @param {string} path the TODO file
   * @param {(text: string) => string} change gets the current text, returns the new text
   * @returns {Promise<void>}
   */
  async edit(path, change) {
    let file = this.fileAt(path);
    if (!file) {
      file = await this.app.vault.create(path, "");
      new Notice(`Created ${file.path}`);
    }
    const cm = this.liveEditor(path);
    const old = await this.text(path);
    const next = change(old);
    if (next === old) return;
    if (!cm || !cm.state.doc.length) await this.app.vault.process(file, () => next);
    else {
      let p = 0;
      while (p < old.length && p < next.length && old[p] === next[p]) p++;
      let s = 0;
      while (s < old.length - p && s < next.length - p && old[old.length - 1 - s] === next[next.length - 1 - s]) s++;
      cm.dispatch({ changes: { from: p, to: old.length - s, insert: next.slice(p, next.length - s) } });
    }
    this.refreshViews();
  }

  /**
   * Find a TODO's current heading line: the remembered line if it still holds that TODO,
   * else the first TODO with the same title (the file may have changed since it was drawn).
   * @param {string} text current document of the TODO's file
   * @param {import("./core.js").Todo} t
   * @returns {number} 0-based line, or -1 if the TODO is gone
   */
  locate(text, t) {
    const all = parseTodos(text);
    const hit = all.find((x) => x.line === t.line && x.title === t.title) || all.find((x) => x.title === t.title);
    return hit ? hit.line : -1;
  }

  /**
   * Edit one TODO in its file: `change(text, line)` gets the document and the TODO's current
   * heading line and returns the new document. Nothing happens if the TODO is gone.
   * @param {FileTodo} t the TODO as it was when drawn
   * @param {(text: string, line: number) => string} change
   * @returns {Promise<void>}
   */
  editTodo(t, change) {
    return this.edit(t.file, (text) => {
      const line = this.locate(text, t);
      return line < 0 ? text : change(text, line);
    });
  }

  /**
   * Mark a TODO done, or open again if it was done. A TODO whose date repeats is not closed:
   * it moves to its next date (see `completeTodo`).
   * @param {FileTodo} t
   * @returns {Promise<void>}
   */
  toggle(t) {
    return this.editTodo(t, (text, line) => {
      if (t.state === "DONE") return setState(text, line, "TODO", new Date());
      const done = completeTodo(text, line, new Date());
      if (done.next) new Notice(`"${t.title}" repeats: next on ${done.next}`);
      return done.text;
    });
  }

  /**
   * "Archive completed TODOs": after a confirmation, move every DONE TODO (with its
   * sub-items) from the files in scope to each file's archive file (`todo.org` ->
   * `todo-archive.org`). An archive is written before its TODO file is changed, so a failure
   * cannot lose TODOs. DONE TODOs with an open sub-TODO stay.
   * @returns {Promise<void>}
   */
  async archiveCompleted() {
    const files = this.scopedFiles();
    const clash = files.find((f) => this.files().includes(archivePath(f)));
    if (clash) {
      new Notice(`Org Todo Planner: ${archivePath(clash)} is also a TODO file, so ${clash} cannot be archived there.`);
      return;
    }
    let total = 0;
    for (const f of files) total += archiveDone(await this.text(f)).count;
    if (!total) { new Notice("No completed TODOs to archive."); return; }
    const where = files.length === 1 ? archivePath(files[0]) : "the archive files (<name>-archive.org)";
    const message = `Move ${total} completed TODO${total === 1 ? "" : "s"} to ${where}?`;
    new ConfirmModal(this.app, { heading: "Archive completed TODOs", message, button: "Archive" }, async () => {
      let moved = 0;
      for (const f of files) {
        const now = archiveDone(await this.text(f));   // the file may have changed while the dialog was open
        if (!now.count) continue;
        const name = archivePath(f);
        const dest = this.fileAt(name);
        if (dest) {
          await this.app.vault.process(dest, (old) => (old && !old.endsWith("\n") ? old + "\n" : old) + now.archived);
        } else await this.app.vault.create(name, now.archived);
        await this.edit(f, (text) => archiveDone(text).text);
        moved += now.count;
      }
      new Notice(`Archived ${moved} TODO${moved === 1 ? "" : "s"}`);
    }).open();
  }

  /**
   * Ask for a new due date for a TODO and apply it.
   * @param {FileTodo} t
   * @returns {void}
   */
  changeDue(t) {
    new DueModal(this.app, { today: dayKey(new Date()), due: t.date, repeat: t.repeat, name: t.title }, (due, repeat) =>
      this.editTodo(t, (text, line) => setDue(text, line, due, repeat))).open();
  }

  /**
   * Move a TODO, with its notes, checkboxes and child headings, to another TODO file (see
   * `moveTodo` in core.js for where it lands). The destination is written first, so a failure
   * cannot lose the TODO.
   * @param {FileTodo} t
   * @param {string} dest the TODO file to move it to
   * @returns {Promise<void>}
   */
  async moveTo(t, dest) {
    if (dest === t.file) return;
    const src = await this.text(t.file);
    const line = this.locate(src, t);
    if (line < 0 || !moveTodo(src, line, "")) { new Notice("Org Todo Planner: that TODO is no longer in the file."); return; }
    await this.edit(dest, (text) => moveTodo(src, line, text).dst);
    await this.editTodo(t, (text, l) => moveTodo(text, l, "").src);
    new Notice(`Moved "${t.title}" to ${fileLabel(dest)}`);
  }

  /**
   * Ask which other TODO file to move a TODO to, then move it.
   * @param {FileTodo} t
   * @returns {void}
   */
  chooseMove(t) {
    const others = this.files().filter((f) => f !== t.file).map((path) => ({ path, label: fileLabel(path) }));
    if (!others.length) { new Notice("Org Todo Planner: add another TODO file in the settings first."); return; }
    new FilePickerModal(this.app, others, (path) => this.moveTo(t, path), `Move "${t.title}" to...`).open();
  }

  /**
   * Make a task a sub-item (a checkbox) of another task in the same file. The task's notes, items
   * and sub-TODOs follow as nested checkboxes; its due date, repeat and tags cannot be kept, and a
   * confirmation says so when there is any. Refused if the target is the task itself or one of its
   * own sub-tasks.
   * @param {FileTodo} src the task to convert
   * @param {FileTodo} dst the task it becomes a sub-item of
   * @returns {Promise<void>}
   */
  async nestTask(src, dst) {
    if (src.virtual) src = src.source;
    if (dst.virtual) dst = dst.source;
    if (src.file !== dst.file) { new Notice("Org Todo Planner: a task can only become a sub-item of a task in the same file."); return; }
    const text = await this.text(src.file);
    const a = this.locate(text, src);
    const b = this.locate(text, dst);
    const res = a < 0 || b < 0 ? null : nestTodo(text, a, b);
    if (!res) { new Notice("Org Todo Planner: that task can't become a sub-item of the target (a task can't go into itself or its own sub-tasks)."); return; }
    const apply = async () => {
      await this.edit(src.file, (cur) => {
        const i = this.locate(cur, src);
        const j = this.locate(cur, dst);
        const r = i < 0 || j < 0 ? null : nestTodo(cur, i, j);
        return r ? r.text : cur;
      });
      new Notice(`"${src.title}" is now a sub-item of "${dst.title}"`);
    };
    if (!res.loss.length) { await apply(); return; }
    const message = `"${src.title}" becomes a sub-item of "${dst.title}". A sub-item is only a tick box, so its ${res.loss.join(" and ")} will not be kept.`;
    new ConfirmModal(this.app, { heading: "Make a sub-item", message, button: "Convert" }, apply).open();
  }

  /**
   * Move a list, with everything under its heading, before or after another list, in every file of
   * `files` that has both lists. Dropping it where it already is changes nothing.
   * @param {string} name the list to move
   * @param {string} target the list it is placed next to
   * @param {"before"|"after"} where
   * @param {string[]} [files] the files to change; defaults to the files in scope
   * @returns {Promise<void>}
   */
  async reorderList(name, target, where, files = this.scopedFiles()) {
    let found = false;
    for (const file of files) {
      await this.edit(file, (text) => {
        const out = reorderList(text, name, target, where);
        if (out !== null) found = true;
        return out === null ? text : out;
      });
    }
    if (!found) new Notice(`Org Todo Planner: no file has both the lists "${name}" and "${target}".`);
  }

  /**
   * Move a list one place left or right among the lists of each file in `files` that has it.
   * @param {string} name the list
   * @param {-1|1} dir -1 towards the start, 1 towards the end
   * @param {string[]} [files] the files to change; defaults to the files in scope
   * @returns {Promise<void>}
   */
  async moveListStep(name, dir, files = this.scopedFiles()) {
    let moved = false;
    for (const file of files) {
      await this.edit(file, (text) => {
        const names = listNames(text);
        const i = names.indexOf(name);
        const other = i < 0 ? undefined : names[i + dir];
        const out = other === undefined ? null : reorderList(text, name, other, dir < 0 ? "before" : "after");
        if (out !== null && out !== text) moved = true;
        return out === null ? text : out;
      });
    }
    if (!moved) new Notice(`Org Todo Planner: "${name}" is already the ${dir < 0 ? "first" : "last"} list.`);
  }

  /**
   * Move a task, with everything under it, to just before or after another task of the same file
   * (it joins that task's list). Dropping it where it already is changes nothing.
   * @param {FileTodo} src the task to move
   * @param {FileTodo} dst the task it is placed next to
   * @param {"before"|"after"} where
   * @returns {Promise<void>}
   */
  async reorderTask(src, dst, where) {
    if (src.virtual) src = src.source;
    if (dst.virtual) dst = dst.source;
    if (src.file !== dst.file) { new Notice("Org Todo Planner: tasks can only be reordered within one file (use Move to another file)."); return; }
    let ok = true;
    await this.edit(src.file, (text) => {
      const a = this.locate(text, src);
      const b = this.locate(text, dst);
      const out = a < 0 || b < 0 ? null : reorderTodo(text, a, b, where);
      ok = out !== null;
      return out === null ? text : out;
    });
    if (!ok) new Notice("Org Todo Planner: a task can't be moved next to one of its own sub-tasks.");
  }

  /**
   * Move a task, with everything under it, to the end of a list of its own file.
   * @param {FileTodo} src the task
   * @param {?string} list the list name, or null for outside any list
   * @returns {Promise<void>}
   */
  async moveTaskToList(src, list) {
    if (src.virtual) src = src.source;
    await this.editTodo(src, (text, line) => moveTodoToList(text, line, list) ?? text);
  }

  /**
   * Give a task another due date (a repeater on its date is kept), e.g. when it is dropped on a day
   * of the week view.
   * @param {FileTodo} src the task
   * @param {string} key "YYYY-MM-DD"
   * @returns {Promise<void>}
   */
  async rescheduleTask(src, key) {
    if (src.virtual) src = src.source;
    await this.editTodo(src, (text, line) => setDue(text, line, key));
    new Notice(`"${src.title}" is now due ${key}`);
  }

  /**
   * Move a task one place up or down among the open tasks of its list (see `siblingTodo`).
   * @param {FileTodo} t the task
   * @param {-1|1} dir -1 up, 1 down
   * @returns {Promise<void>}
   */
  async moveTaskStep(t, dir) {
    if (t.virtual) t = t.source;
    let moved = false;
    await this.editTodo(t, (text, line) => {
      const other = siblingTodo(text, line, dir);
      const out = other === null ? null : reorderTodo(text, line, other, dir < 0 ? "before" : "after");
      moved = out !== null;
      return out === null ? text : out;
    });
    if (!moved) new Notice(`Org Todo Planner: "${t.title}" is already the ${dir < 0 ? "first" : "last"} task of its list.`);
  }

  /**
   * Turn a sub-item (a checkbox) into a task of its own, in the same file: by default in the same
   * list as the task it belonged to, or in `target.list`, with the due date `target.due`. Its nested
   * items and notes come along and a ticked item becomes a DONE task.
   * @param {FileTodo} t the task the item belongs to, as drawn
   * @param {{line: number, text: string}} item one of `t.items`
   * @param {{list?: ?string, due?: ?string}} [target] where the new task goes; `list` null means
   *   outside any list, left out means the item's own list
   * @returns {Promise<void>}
   */
  async promoteItem(t, item, target = {}) {
    const list = target.list === undefined ? t.list : target.list;
    let done = false;
    await this.editTodo(t, (text, line) => {
      const r = promoteItem(text, line, line + (item.line - t.line), { list, due: target.due || null, now: new Date(), column: this.settings.tagsColumn });
      done = !!r;
      return r ? r.text : text;
    });
    new Notice(done ? `"${item.text}" is now a task${list ? ` in ${list}` : ""}${target.due ? `, due ${target.due}` : ""}` : "Org Todo Planner: that sub-item is no longer in the file.");
  }

  /**
   * Show the menu of a sub-item (right-click, long-press): make it a task, or delete it.
   * @param {MouseEvent} e the contextmenu event
   * @param {FileTodo} t the task the item belongs to
   * @param {{line: number, text: string}} item
   * @returns {void}
   */
  itemMenu(e, t, item) {
    e.preventDefault();
    const menu = new Menu();
    menu.addItem((i) => i.setTitle("Make it a task").setIcon("arrow-up-right").onClick(() => this.promoteItem(t, item)));
    menu.addSeparator();
    menu.addItem((i) => {
      i.setTitle("Delete").setIcon("trash").onClick(() => this.deleteItem(t, item));
      if (i.setWarning) i.setWarning(true);
    });
    menu.showAtMouseEvent(e);
  }

  /**
   * Ask which task of the same file a task should become a sub-item of (the touch-friendly
   * alternative to dragging), then do it.
   * @param {FileTodo} t the task to convert
   * @returns {Promise<void>}
   */
  async chooseNest(t) {
    if (t.virtual) t = t.source;
    const text = await this.text(t.file);
    const line = this.locate(text, t);
    const range = line < 0 ? null : todoSubtree(text, line);
    if (!range) { new Notice("Org Todo Planner: that TODO is no longer in the file."); return; }
    const targets = (await this.snapshot([t.file])).todos
      .filter((x) => x.state === "TODO" && !(x.line >= range.start && x.line < range.end));
    if (!targets.length) { new Notice("Org Todo Planner: there is no other open task in this file."); return; }
    new TaskPickerModal(this.app, targets, (dst) => this.nestTask(t, dst), `Make "${t.title}" a sub-item of...`).open();
  }

  /**
   * Ask for a new title for a TODO and apply it (state, tags, date and sub-items stay).
   * @param {FileTodo} t
   * @returns {void}
   */
  renameTask(t) {
    if (t.virtual) t = t.source;   // a projected occurrence: the real TODO is renamed
    new PromptModal(this.app, { heading: "Rename TODO", placeholder: "Title", button: "Rename", value: t.title }, async (title) => {
      if (title.trim() === t.title) return;
      let ok = true;
      await this.editTodo(t, (text, line) => {
        const next = renameTodo(text, line, title, this.settings.tagsColumn);
        ok = next !== text;
        return next;
      });
      if (!ok) new Notice("Org Todo Planner: that title can't be used (it is empty, has several lines or ends in :tags:).");
    }).open();
  }

  /**
   * Ask for a new name for a list and apply it in every file in scope that has the list; the
   * Tasks pane keeps showing it. Refused if a file already has a list with the new name.
   * @param {string} name the current list name
   * @param {string[]} [scope] the files to look in; defaults to the files in scope
   * @returns {void}
   */
  renameList(name, scope = this.scopedFiles()) {
    new PromptModal(this.app, { heading: "Rename list", placeholder: "List name", button: "Rename", value: name }, async (newName) => {
      if (newName === name) return;
      if (!isListName(newName)) { new Notice("Org Todo Planner: that list name is not usable (it can't start with TODO or DONE, or end with :tags:)."); return; }
      const files = [];
      for (const file of scope) {
        const names = listNames(await this.text(file));
        if (!names.includes(name)) continue;
        if (names.includes(newName)) { new Notice(`Org Todo Planner: ${fileLabel(file)} already has a list "${newName}".`); return; }
        files.push(file);
      }
      if (!files.length) { new Notice(`Org Todo Planner: there is no list "${name}".`); return; }
      for (const view of [...this.panes(TASKS_VIEW), ...this.panes(FILE_VIEW)]) {
        if (!view.all && view.list === name) view.list = newName;
      }
      for (const file of files) await this.edit(file, (text) => renameList(text, name, newName, this.settings.tagsColumn).text);
      new Notice(`Renamed the list to "${newName}"`);
    }).open();
  }

  /**
   * Delete a TODO, with its notes, checkboxes and child headings, after a confirmation. For a
   * repeating TODO that removes all its future occurrences too.
   * @param {FileTodo} t
   * @returns {Promise<void>}
   */
  async deleteTask(t) {
    if (t.virtual) t = t.source;   // a projected occurrence: the real TODO is deleted
    const text = await this.text(t.file);
    const line = this.locate(text, t);
    const { count } = line < 0 ? { count: 0 } : deleteTodo(text, line);
    if (!count) { new Notice("Org Todo Planner: that TODO is no longer in the file."); return; }
    const extra = [
      count > 1 ? `its ${count - 1} sub-TODO${count === 2 ? "" : "s"}` : "",
      t.repeat ? "all its future occurrences" : "",
    ].filter(Boolean);
    const message = `Delete "${t.title}"${extra.length ? " and " + extra.join(" and ") : ""} from ${fileLabel(t.file)}? Its notes and sub-items go too.`;
    new ConfirmModal(this.app, { heading: "Delete TODO", message, button: "Delete" }, async () => {
      await this.editTodo(t, (cur, l) => deleteTodo(cur, l).text);
      new Notice(`Deleted "${t.title}"`);
    }).open();
  }

  /**
   * Show the menu of a TODO row (right-click, long-press, or the row's ⋯ button).
   * @param {MouseEvent} e the contextmenu or click event
   * @param {FileTodo} t
   * @returns {void}
   */
  todoMenu(e, t) {
    e.preventDefault();
    if (t.virtual) t = t.source;   // a projected occurrence: act on the real TODO
    const menu = new Menu();
    menu.addItem((i) => i.setTitle("Rename").setIcon("pencil").onClick(() => this.renameTask(t)));
    menu.addItem((i) => i.setTitle("Set due date").setIcon("calendar").onClick(() => this.changeDue(t)));
    menu.addItem((i) => i.setTitle("Move up").setIcon("arrow-up").onClick(() => this.moveTaskStep(t, -1)));
    menu.addItem((i) => i.setTitle("Move down").setIcon("arrow-down").onClick(() => this.moveTaskStep(t, 1)));
    if (this.files().length > 1) {
      menu.addItem((i) => i.setTitle("Move to another file").setIcon("folder-input").onClick(() => this.chooseMove(t)));
    }
    if (t.state === "TODO") {
      menu.addItem((i) => i.setTitle("Make a sub-item of...").setIcon("indent").onClick(() => this.chooseNest(t)));
    }
    menu.addItem((i) => i.setTitle("Open in file").setIcon("file-text").onClick(() => this.goToLine(t.line, t.file)));
    menu.addSeparator();
    menu.addItem((i) => {
      i.setTitle("Delete").setIcon("trash").onClick(() => this.deleteTask(t));
      if (i.setWarning) i.setWarning(true);
    });
    menu.showAtMouseEvent(e);
  }

  /**
   * "New TODO": ask for the title, due date and tags (and the file, if there are several),
   * then add it.
   * @param {?string} [due] "YYYY-MM-DD" to preselect; defaults to the planner's selected day
   * @returns {void}
   */
  newTodo(due) {
    const planner = this.panes(PLANNER_VIEW)[0];
    const day = due !== undefined ? due : planner ? planner.selected : dayKey(new Date());
    const files = this.files().map((path) => ({ path, label: fileLabel(path) }));
    new TodoModal(this.app, { today: dayKey(new Date()), due: day, files, file: this.defaultFile() }, (todo) =>
      this.edit(todo.file, (text) => addTodo(text, todo, this.settings.tagsColumn).text)).open();
  }

  /**
   * Run `action` for the TODO under the cursor of the active TODO file's editor.
   * @param {boolean} check true when Obsidian only asks whether the command is available
   * @param {(t: FileTodo) => void} action
   * @returns {boolean} whether the command applies now
   */
  atCursor(check, action) {
    const view = this.app.workspace.getActiveViewOfType(ItemView);
    const file = view && view.codeMirror && this.files().find((f) => this.liveEditor(f) === view.codeMirror);
    if (!file) return false;
    const cm = view.codeMirror;
    const doc = cm.state.doc;
    const line = doc.lineAt(cm.state.selection.main.head).number - 1;
    const t = parseTodos(doc.toString()).find((x) => x.line <= line && line < x.end);
    if (!t) return false;
    if (!check) action(Object.assign(t, { file }));
    return true;
  }

  /**
   * Open the planner pane, reusing one that already exists.
   * @returns {Promise<void>}
   */
  openPlanner() { return this.openPane(PLANNER_VIEW); }

  /**
   * Open a pane of the given view type, reusing one that already exists. It opens in the
   * main area or the right sidebar according to the "Open panes in" setting; "Automatic"
   * picks the main area on mobile, where the sidebar is a swipe-in drawer.
   * @param {string} type PLANNER_VIEW or TASKS_VIEW
   * @returns {Promise<void>}
   */
  async openPane(type) {
    const ws = this.app.workspace;
    let leaf = ws.getLeavesOfType(type)[0];
    if (!leaf) {
      const where = this.settings.panePlacement;
      const main = where === "main" || (where === "auto" && Platform.isMobile);
      leaf = main ? ws.getLeaf("tab") : ws.getRightLeaf(false);
      await leaf.setViewState({ type, active: true });
    }
    if (leaf.loadIfDeferred) await leaf.loadIfDeferred();   // a tab not shown yet is only a placeholder
    ws.revealLeaf(leaf);
  }

  /**
   * Add a task, to the end of a list's section if one is given.
   * @param {{title: string, due: ?string, list: ?string, file?: string}} task `due` is
   *   "YYYY-MM-DD"; `file` defaults to the scope file, else the first TODO file
   * @returns {Promise<void>}
   */
  addTask(task) {
    return this.edit(task.file || this.defaultFile(), (text) => addTodo(text, task, this.settings.tagsColumn).text);
  }

  /**
   * Add an empty list (a top-level heading) unless it exists.
   * @param {string} name
   * @param {string} [file] defaults to the scope file, else the first TODO file
   * @returns {Promise<void>}
   */
  addList(name, file) { return this.edit(file || this.defaultFile(), (text) => addList(text, name)); }

  /**
   * Add a TODO file: create it (and its folder) if it does not exist, add it to the settings and
   * limit the panes to it. A file that is already in the list is just selected.
   * @param {string} name what the user typed, e.g. "things_to_buy" or "work/home"; a name without
   *   a folder goes into the first task folder, else next to the first TODO file
   * @returns {Promise<?string>} the file's path, or null if the name is not usable
   */
  async addFile(name) {
    const first = this.files()[0];
    const taskFolder = (this.settings.taskFolders || []).map((f) => f.trim().replace(/^\/+|\/+$/g, "")).find(Boolean);
    const dir = taskFolder ? taskFolder + "/" : first.includes("/") ? first.replace(/[^/]*$/, "") : "";
    const path = orgPath(name, dir);
    if (!path) { new Notice("Org Todo Planner: that is not a usable file name."); return null; }
    try {
      if (!this.fileAt(path)) {
        const folder = path.includes("/") ? path.replace(/\/[^/]*$/, "") : "";
        if (folder && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
        // the header makes the file open as tasks (see `plannerSetting`)
        await this.app.vault.create(path, `#+TITLE: ${fileLabel(path)}\n#+PLANNER: tasks\n`);
        this.invalidateFiles();
      }
    } catch (err) {
      new Notice(`Org Todo Planner: could not create ${path}: ${err.message || err}`);
      return null;
    }
    if (!this.files().includes(path)) {
      this.settings.files = [...this.settings.files, path];
      await this.saveSettings();
      new Notice(`Added ${path}`);
    }
    this.setScope(path);
    return path;
  }

  /**
   * "New TODO file": ask for a name, add the file and show the Tasks pane.
   * @returns {void}
   */
  newFile() {
    new PromptModal(this.app, { heading: "New TODO file", placeholder: "e.g. things_to_buy or work", button: "Create" }, async (name) => {
      if (await this.addFile(name)) await this.openPane(TASKS_VIEW);
    }).open();
  }

  /**
   * "New list": ask for a name, add the list and show it. Without `file` it goes to the file in
   * scope (asking which, if there are several and none is selected) and the Tasks pane opens;
   * with `file` (from a file-bound view) it goes there.
   * @param {?string} [file] the file to create the list in
   * @returns {void}
   */
  newList(file = null) {
    new PromptModal(this.app, { heading: "New list", placeholder: "e.g. Groceries", button: "Create" }, (name) => {
      if (!this.listNameOk(name)) return;
      if (file) this.createList(name, file, false);
      else if (this.files().length > 1 && !this.scope) {
        const files = this.files().map((path) => ({ path, label: fileLabel(path) }));
        new FilePickerModal(this.app, files, (target) => this.createList(name, target, true), `Create "${name}" in...`).open();
      } else this.createList(name, this.defaultFile(), true);
    }).open();
  }

  /**
   * @param {string} name a proposed list name
   * @returns {boolean} whether it is usable; if not, a notice says why
   */
  listNameOk(name) {
    if (isListName(name)) return true;
    new Notice("Org Todo Planner: that list name is not usable (it can't start with TODO or DONE, or end with :tags:).");
    return false;
  }

  /**
   * Add a list to a file and show it in the open Tasks panes that include that file.
   * @param {string} name the list name
   * @param {string} target the TODO file to create it in
   * @param {boolean} openTasks also open the Tasks pane (not needed from a file-bound view)
   * @returns {Promise<void>}
   */
  async createList(name, target, openTasks) {
    await this.addList(name, target);
    if (openTasks) await this.openPane(TASKS_VIEW);
    for (const view of [...this.panes(TASKS_VIEW), ...this.panes(FILE_VIEW)]) {
      if (!view.files().includes(target)) continue;
      view.all = false;
      view.list = name;
      view.render();
    }
  }

  /**
   * "New list or file": one dialog, like New TODO, to create either a list (in a chosen file) or a
   * whole new TODO file, then show the result in the Tasks pane.
   * @returns {void}
   */
  newCategory() {
    const files = this.files().map((path) => ({ path, label: fileLabel(path) }));
    new CategoryModal(this.app, { files, file: this.defaultFile() }, async ({ kind, name, file }) => {
      if (kind === "file") { if (await this.addFile(name)) await this.openPane(TASKS_VIEW); return; }
      if (this.listNameOk(name)) await this.createList(name, file, true);
    }).open();
  }

  /**
   * Tick or untick a checkbox item of a TODO.
   * @param {FileTodo} t the TODO as it was when drawn
   * @param {{line: number}} item one of `t.items`
   * @returns {Promise<void>}
   */
  toggleItem(t, item) {
    return this.editTodo(t, (text, line) => toggleItem(text, line + (item.line - t.line)));
  }

  /**
   * Delete one checkbox item of a TODO.
   * @param {FileTodo} t the TODO as it was when drawn
   * @param {{line: number}} item one of `t.items`
   * @returns {Promise<void>}
   */
  deleteItem(t, item) {
    return this.editTodo(t, (text, line) => deleteItem(text, line + (item.line - t.line)));
  }

  /**
   * Delete a list, with all its tasks and everything else under its heading, from the files in
   * scope that have it, after a confirmation that says how much goes.
   * @param {string} name the list name
   * @param {string[]} [scope] the files to look in; defaults to the files in scope
   * @returns {Promise<void>}
   */
  async deleteList(name, scope = this.scopedFiles()) {
    const hits = [];
    for (const file of scope) {
      const found = deleteList(await this.text(file), name);
      if (found.text !== await this.text(file)) hits.push({ file, count: found.count });
    }
    if (!hits.length) { new Notice(`Org Todo Planner: there is no list "${name}".`); return; }
    const tasks = hits.reduce((sum, h) => sum + h.count, 0);
    const where = hits.map((h) => fileLabel(h.file)).join(" and ");
    const message = `Delete the list "${name}" from ${where}, with its ${tasks} task${tasks === 1 ? "" : "s"} and everything else under it? `
      + "Use Archive first if you want to keep the finished ones.";
    new ConfirmModal(this.app, { heading: "Delete list", message, button: "Delete list" }, async () => {
      for (const h of hits) await this.edit(h.file, (text) => deleteList(text, name).text);
      new Notice(`Deleted the list "${name}"`);
    }).open();
  }

  /**
   * Add a checkbox item to a TODO.
   * @param {FileTodo} t the TODO as it was when drawn
   * @param {string} label
   * @returns {Promise<void>}
   */
  addItem(t, label) { return this.editTodo(t, (text, line) => addItem(text, line, label)); }

  /**
   * Whether a file should open as tasks: it is one of the TODO files (listed in the settings or in
   * a task folder), or its header says so (`#+PLANNER: tasks`). `#+PLANNER: off` in the header
   * always wins, so a file can opt out.
   * @param {TFile} file an `.org` file
   * @returns {Promise<boolean>}
   */
  async opensAsTasks(file) {
    const setting = plannerSetting(await this.app.vault.cachedRead(file));
    return setting !== null ? setting : this.isTodoFile(file.path);
  }

  /**
   * The vault path of the file an Org-editor tab shows. A tab Obsidian has not loaded yet, or whose
   * view has not got its file yet, is read from its saved state.
   * @param {import("obsidian").WorkspaceLeaf} leaf
   * @returns {?string}
   */
  leafPath(leaf) {
    if (leaf.view && leaf.view.file && leaf.view.file.path) return leaf.view.file.path;
    const state = leaf.getViewState && leaf.getViewState();
    return (state && state.state && state.state.file) || null;
  }

  /**
   * Switch every Org-editor tab that shows a file that should open as tasks (see `opensAsTasks`)
   * to the file-bound tasks view. Tabs where the user chose the text editor are left alone. It runs
   * after file opens, tab and layout changes and at start-up, and covers tabs that were already
   * open, so it does not depend on the exact timing of Obsidian's events. A tab that was checked
   * and should stay text is remembered, so a file is not re-read on every layout change.
   * @returns {Promise<void>}
   */
  async sweepLeaves() {
    if (!this.settings.openAsTasks) return;
    if (this.sweeping) { this.sweepAgain = true; return; }
    this.sweeping = true;
    try {
      do {
        this.sweepAgain = false;
        const ws = this.app.workspace;
        for (const leaf of ws.getLeavesOfType(ORG_VIEW)) {
          const path = this.leafPath(leaf);
          if (!path || this.rawLeaves.get(leaf) === path) continue;
          if (this.stayText.get(leaf) === path) continue;
          const file = this.fileAt(path);
          if (!file) continue;
          if (!(await this.opensAsTasks(file))) { this.stayText.set(leaf, path); continue; }
          if (this.leafPath(leaf) !== path || this.rawLeaves.get(leaf) === path) continue;   // changed meanwhile
          await leaf.setViewState({ type: FILE_VIEW, state: { file: path }, active: leaf === ws.getMostRecentLeaf() });
        }
      } while (this.sweepAgain);
    } finally {
      this.sweeping = false;
    }
  }

  /**
   * Run `sweepLeaves` shortly (several events often come together).
   * @returns {void}
   */
  sweepSoon() {
    clearTimeout(this.sweepTimer);
    this.sweepTimer = setTimeout(() => this.sweepLeaves(), 60);
  }

  /**
   * Forget which tabs were checked (after the TODO files or the setting changed) and sweep again.
   * @returns {void}
   */
  recheckLeaves() {
    this.stayText = new WeakMap();
    this.sweepSoon();
  }

  /**
   * "Why does this file open as text?": show what decides how the active file opens.
   * @returns {Promise<void>}
   */
  async explainOpen() {
    const ws = this.app.workspace;
    const file = ws.getActiveFile();
    if (!file) { new Notice("Org Todo Planner: no active file."); return; }
    const isOrg = /\.org$/i.test(file.path);
    const setting = isOrg ? plannerSetting(await this.app.vault.cachedRead(file)) : null;
    const leaf = ws.getMostRecentLeaf();
    const lines = [
      `File: ${file.path}`,
      `In TODO files / task folders: ${this.isTodoFile(file.path) ? "yes" : "no"}`,
      `Header #+PLANNER: ${setting === null ? "none" : setting ? "tasks" : "off"}`,
      `"Open TODO files as tasks" setting: ${this.settings.openAsTasks ? "on" : "off"}`,
      `Active tab view: ${leaf && leaf.view ? leaf.view.getViewType() : "?"}`,
      `Text editor chosen for this tab: ${leaf && this.rawLeaves.get(leaf) === file.path ? "yes" : "no"}`,
      `Should open as tasks: ${isOrg && await this.opensAsTasks(file) ? "yes" : "no"}`,
    ];
    new Notice(lines.join("\n"), 20000);
  }

  /**
   * Open a file in the file-bound tasks view: in its existing tasks tab, else in the tab that
   * shows it in the Org editor, else in a new tab.
   * @param {string} path vault path of an `.org` file
   * @returns {Promise<void>}
   */
  async openAsTasks(path) {
    const ws = this.app.workspace;
    let leaf = ws.getLeavesOfType(FILE_VIEW).find((l) => {
      const st = l.getViewState();
      return st && st.state && st.state.file === path;
    });
    if (!leaf) {
      leaf = ws.getLeavesOfType(ORG_VIEW).find((l) => l.view.file && l.view.file.path === path) || ws.getLeaf("tab");
      this.rawLeaves.delete(leaf);
      await leaf.setViewState({ type: FILE_VIEW, state: { file: path }, active: true });
    }
    if (leaf.loadIfDeferred) await leaf.loadIfDeferred();
    ws.revealLeaf(leaf);
  }

  /**
   * Switch a file-bound tasks tab to the Org text editor, and keep it there.
   * @param {TodoFileView} view
   * @returns {Promise<void>}
   */
  async editAsText(view) {
    const file = this.fileAt(view.path);
    if (!file) return;
    if (!this.hasOrgReader()) { new Notice("Org Todo Planner needs the Org Reader community plugin to edit .org files as text."); return; }
    this.rawLeaves.set(view.leaf, view.path);
    await view.leaf.openFile(file);
  }

  /**
   * Add `#+PLANNER: tasks` to a file's header so it opens as tasks, then open it that way.
   * @param {string} path vault path of an `.org` file
   * @returns {Promise<void>}
   */
  async markAsTasks(path) {
    await this.edit(path, addPlannerMarker);
    await this.openAsTasks(path);
  }

  /**
   * Add a file to the TODO files (so the planner and the Tasks pane show its tasks).
   * @param {string} path
   * @returns {Promise<void>}
   */
  async registerFile(path) {
    if (!this.files().includes(path)) {
      this.settings.files = [...this.settings.files, path];
      await this.saveSettings();
      new Notice(`Added ${path}`);
    }
    this.filesChanged();
  }

  /**
   * "Open TODO file as tasks" / "Open TODO file": with one file open it, with several ask which.
   * @param {boolean} [asTasks=false] open in the file-bound tasks view instead of the Org editor
   * @returns {void}
   */
  openFileAs(asTasks = false) {
    const files = this.files();
    const open = (path) => (asTasks ? this.openAsTasks(path) : this.goToLine(0, path));
    if (files.length === 1) { open(files[0]); return; }
    new FilePickerModal(this.app, files.map((path) => ({ path, label: fileLabel(path) })), open).open();
  }

  /**
   * "Open TODO file": with one file open it in the Org editor, with several ask which.
   * @returns {void}
   */
  openFile() { this.openFileAs(false); }

  /**
   * Open a TODO file and put the cursor on a line.
   * @param {number} line 0-based
   * @param {string} [path] the TODO file; defaults to the scope file, else the first one
   * @returns {Promise<void>}
   */
  async goToLine(line, path = this.defaultFile()) {
    if (!this.hasOrgReader()) {
      new Notice("Org Todo Planner needs the Org Reader community plugin to open .org files.");
      return;
    }
    const file = this.fileAt(path);
    if (!file) { new Notice(`Org Todo Planner: "${path}" does not exist yet. Add a TODO first.`); return; }
    const ws = this.app.workspace;
    let leaf = ws.getLeavesOfType(ORG_VIEW).find((l) => l.view.file && l.view.file.path === file.path);
    if (leaf) await ws.revealLeaf(leaf);
    else {
      leaf = ws.getLeaf("tab");
      this.rawLeaves.set(leaf, file.path);   // the text editor was asked for: do not switch this tab to tasks
      await leaf.openFile(file);
    }
    if (leaf.view && leaf.view.readerMode === "read") leaf.view.setReaderMode("edit");
    const cm = leaf.view && leaf.view.codeMirror;
    if (!cm) return;
    const doc = cm.state.doc;
    const pos = doc.line(Math.min(line + 1, doc.lines)).from;
    cm.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: 8 }) });
    cm.focus();
  }
}
