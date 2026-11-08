// Dialogs: the new-TODO form and the due-date picker. Both share the "when" controls:
// a text box that understands "tomorrow", "fri", "+3d" or a date, a calendar date input,
// and quick buttons.
import { Modal, Setting, SuggestModal } from "obsidian";
import { parseDate, parseTags, addDays, repeatFor, describeRepeat } from "./core.js";

/**
 * Add the date controls to a dialog.
 * @param {HTMLElement} el where to add them
 * @param {{today: string, initial: ?string, clearable: boolean}} opts `initial` is the
 *   starting "YYYY-MM-DD"; `clearable` adds a "No date" button
 * @param {(submit: boolean) => void} done called with true when Enter is pressed in the text box
 * @returns {() => ?string|undefined} reads the chosen date: a key, null for none, or
 *   undefined if the typed text is not understood
 */
function dateControls(el, { today, initial, clearable }, done) {
  let value = initial;
  let text, picker;
  const show = () => {
    picker.value = value || "";
    if (document.activeElement !== text.inputEl) text.setValue(value || "");
    text.inputEl.toggleClass("mod-error", false);
  };
  new Setting(el).setName("Due")
    .setDesc("Type tomorrow, fri, +3d or 2026-11-20, or pick a day")
    .addText((t) => {
      text = t;
      t.setPlaceholder("no date").onChange((v) => {
        const k = parseDate(v, today);
        t.inputEl.toggleClass("mod-error", k === undefined);
        if (k !== undefined) { value = k; picker.value = k || ""; }
      });
      t.inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); done(true); } });
    })
    .then((s) => {
      picker = s.controlEl.createEl("input", { type: "date" });
      picker.onchange = () => { value = picker.value || null; show(); };
    });
  const quick = new Setting(el).setName("Quick");
  const set = (k) => { value = k; show(); };
  quick.addButton((b) => b.setButtonText("Today").onClick(() => set(today)));
  quick.addButton((b) => b.setButtonText("Tomorrow").onClick(() => set(addDays(today, 1))));
  quick.addButton((b) => b.setButtonText("Next week").onClick(() => set(addDays(today, 7))));
  if (clearable) quick.addButton((b) => b.setButtonText("No date").onClick(() => set(null)));
  show();
  return () => {
    const typed = text.getValue();
    return typed.trim() && parseDate(typed, today) === undefined ? undefined : value;
  };
}

/** Intervals offered in the "Repeat" dropdown, as [value, label]; "" means no repeat. */
const REPEATS = [["", "Does not repeat"], ["1d", "Every day"], ["1w", "Every week"], ["2w", "Every 2 weeks"], ["1m", "Every month"], ["1y", "Every year"]];

/**
 * Add the "Repeat" dropdown to a dialog.
 * @param {HTMLElement} el where to add it
 * @param {?import("./core.js").Repeat} initial the current repeater; one that is not among the
 *   presets (e.g. every 3 days) is offered as an extra option
 * @returns {() => ?import("./core.js").Repeat} reads the chosen repeater (null for none)
 */
function repeatControl(el, initial) {
  const options = REPEATS.slice();
  const current = initial ? `${initial.n}${initial.unit}` : "";
  if (initial && !options.some(([v]) => v === current)) {
    const text = describeRepeat(initial);
    options.push([current, text[0].toUpperCase() + text.slice(1)]);
  }
  let value = current;
  new Setting(el).setName("Repeat")
    .setDesc("When you tick a repeating TODO it moves to its next date instead of closing")
    .addDropdown((d) => d.addOptions(Object.fromEntries(options)).setValue(value).onChange((v) => (value = v)));
  return () => repeatFor(value, initial);
}

/**
 * "New TODO" form: title, tags and a due date, and the file when there are several. Enter in
 * the title or the date box (or the button) closes it and calls `onSubmit({title, tags, due, repeat, file})`.
 */
export class TodoModal extends Modal {
  /**
   * @param {import("obsidian").App} app
   * @param {{today: string, due: ?string, files: Array<{path: string, label: string}>, file: string}} opts
   *   today's key, the day to preselect, the TODO files to choose from and the preselected one
   * @param {(todo: {title: string, tags: string[], due: ?string, repeat: ?import("./core.js").Repeat, file: string}) => void} onSubmit
   */
  constructor(app, { today, due, files, file }, onSubmit) {
    super(app);
    this.today = today;
    this.startDue = due;
    this.files = files;
    this.file = file;
    this.onSubmit = onSubmit;
    this.todoTitle = "";
    this.tags = "";
  }
  /**
   * Build the form.
   * @returns {void}
   */
  onOpen() {
    this.titleEl.setText("New TODO");
    let readDue, readRepeat;
    const submit = () => {
      const title = this.todoTitle.trim();
      if (!title) { this.titleInput.inputEl.focus(); return; }
      const due = readDue();
      if (due === undefined) return;
      this.close();
      this.onSubmit({ title, tags: parseTags(this.tags), due, repeat: due ? readRepeat() : null, file: this.file });
    };
    new Setting(this.contentEl).setName("TODO").addText((t) => {
      this.titleInput = t;
      t.onChange((v) => (this.todoTitle = v));
      t.inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
      setTimeout(() => t.inputEl.focus(), 0);
    });
    readDue = dateControls(this.contentEl, { today: this.today, initial: this.startDue, clearable: true }, submit);
    readRepeat = repeatControl(this.contentEl, null);
    if (this.files.length > 1) {
      new Setting(this.contentEl).setName("File")
        .addDropdown((d) => d.addOptions(Object.fromEntries(this.files.map((f) => [f.path, f.label])))
          .setValue(this.file).onChange((v) => (this.file = v)));
    }
    new Setting(this.contentEl).setName("Tags").setDesc("Optional, separated by spaces or commas")
      .addText((t) => t.onChange((v) => (this.tags = v)));
    new Setting(this.contentEl).addButton((b) => b.setButtonText("Add").setCta().onClick(submit));
  }
  /**
   * Empty the dialog.
   * @returns {void}
   */
  onClose() { this.contentEl.empty(); }
}

/** Picker over the TODO files; `onChoose(path)` gets the pick. */
export class FilePickerModal extends SuggestModal {
  /**
   * @param {import("obsidian").App} app
   * @param {Array<{path: string, label: string}>} files what to pick from
   * @param {(path: string) => void} onChoose called with the picked file's path
   * @param {string} [placeholder] hint text for the search box
   */
  constructor(app, files, onChoose, placeholder = "Pick a TODO file") {
    super(app);
    this.files = files;
    this.chosen = onChoose;
    this.setPlaceholder(placeholder);
  }
  /**
   * @param {string} q
   * @returns {Array<{path: string, label: string}>} the files whose name or path contains `q`
   */
  getSuggestions(q) {
    q = q.toLowerCase();
    return this.files.filter((f) => f.path.toLowerCase().includes(q));
  }
  /**
   * Draw one file: its label, with the path under it.
   * @param {{path: string, label: string}} f
   * @param {HTMLElement} el
   * @returns {void}
   */
  renderSuggestion(f, el) {
    el.createDiv({ text: f.label });
    el.createDiv({ cls: "todo-planner-empty", text: f.path });
  }
  /**
   * @param {{path: string}} f the picked file
   * @returns {void}
   */
  onChooseSuggestion(f) { this.chosen(f.path); }
}

/**
 * "New list or file" form, the counterpart of the New TODO form: a name, whether it is a list
 * (a heading inside a file) or a file of its own, and, for a list when there are several files,
 * which file. Enter in the name (or the button) closes it and calls
 * `onSubmit({kind, name, file})`; `kind` is "list" or "file".
 */
export class CategoryModal extends Modal {
  /**
   * @param {import("obsidian").App} app
   * @param {{files: Array<{path: string, label: string}>, file: string, kind?: "list"|"file"}} opts
   *   the TODO files to choose from, the preselected one and what to create first
   * @param {(result: {kind: "list"|"file", name: string, file: string}) => void} onSubmit
   */
  constructor(app, { files, file, kind = "list" }, onSubmit) {
    super(app);
    this.files = files;
    this.file = file;
    this.kind = kind;
    this.onSubmit = onSubmit;
    this.categoryName = "";
  }
  /**
   * Build the form.
   * @returns {void}
   */
  onOpen() {
    this.titleEl.setText("New list or file");
    let where;
    const showWhere = () => where.settingEl.toggleClass("todo-planner-hidden", !(this.kind === "list" && this.files.length > 1));
    const submit = () => {
      const name = this.categoryName.trim();
      if (!name) { this.nameInput.inputEl.focus(); return; }
      this.close();
      this.onSubmit({ kind: this.kind, name, file: this.file });
    };
    new Setting(this.contentEl).setName("Name").setDesc("e.g. Groceries (a list) or things_to_buy (a file)").addText((t) => {
      this.nameInput = t;
      t.onChange((v) => (this.categoryName = v));
      t.inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
      setTimeout(() => t.inputEl.focus(), 0);
    });
    new Setting(this.contentEl).setName("Create")
      .setDesc("A list is a group of tasks inside a file; a file is a whole new .org file with its own lists")
      .addDropdown((d) => d.addOptions({ list: "A list", file: "A file" }).setValue(this.kind).onChange((v) => { this.kind = v; showWhere(); }));
    where = new Setting(this.contentEl).setName("In file")
      .addDropdown((d) => d.addOptions(Object.fromEntries(this.files.map((f) => [f.path, f.label]))).setValue(this.file).onChange((v) => (this.file = v)));
    showWhere();
    new Setting(this.contentEl).addButton((b) => b.setButtonText("Create").setCta().onClick(submit));
  }
  /**
   * Empty the dialog.
   * @returns {void}
   */
  onClose() { this.contentEl.empty(); }
}

/** Picker over tasks; `onChoose(task)` gets the pick. */
export class TaskPickerModal extends SuggestModal {
  /**
   * @param {import("obsidian").App} app
   * @param {Array<import("./main.js").FileTodo>} tasks what to pick from
   * @param {(task: import("./main.js").FileTodo) => void} onChoose called with the picked task
   * @param {string} [placeholder] hint text for the search box
   */
  constructor(app, tasks, onChoose, placeholder = "Pick a task") {
    super(app);
    this.tasks = tasks;
    this.chosen = onChoose;
    this.setPlaceholder(placeholder);
  }
  /**
   * @param {string} q
   * @returns {Array<import("./main.js").FileTodo>} the tasks whose title or list contains `q`
   */
  getSuggestions(q) {
    q = q.toLowerCase();
    return this.tasks.filter((t) => `${t.title} ${t.list || ""}`.toLowerCase().includes(q));
  }
  /**
   * Draw one task: its title, with its list under it.
   * @param {import("./main.js").FileTodo} t
   * @param {HTMLElement} el
   * @returns {void}
   */
  renderSuggestion(t, el) {
    el.createDiv({ text: t.title });
    if (t.list) el.createDiv({ cls: "todo-planner-empty", text: t.list });
  }
  /**
   * @param {import("./main.js").FileTodo} t the picked task
   * @returns {void}
   */
  onChooseSuggestion(t) { this.chosen(t); }
}

/** Asks for one line of text; Enter or the button calls `onSubmit(text)` (empty text is ignored). */
export class PromptModal extends Modal {
  /**
   * @param {import("obsidian").App} app
   * @param {{heading: string, placeholder?: string, button: string, value?: string}} opts texts
   *   for the dialog; `value` is the text the box starts with (selected, so typing replaces it)
   * @param {(text: string) => void} onSubmit
   */
  constructor(app, { heading, placeholder = "", button, value = "" }, onSubmit) {
    super(app);
    this.heading = heading;
    this.placeholder = placeholder;
    this.button = button;
    this.onSubmit = onSubmit;
    this.value = value;
  }
  /**
   * Build the dialog.
   * @returns {void}
   */
  onOpen() {
    this.titleEl.setText(this.heading);
    const submit = () => {
      const v = this.value.trim();
      if (!v) return;
      this.close();
      this.onSubmit(v);
    };
    new Setting(this.contentEl).addText((t) => {
      t.setPlaceholder(this.placeholder).setValue(this.value).onChange((v) => (this.value = v));
      t.inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
      setTimeout(() => { t.inputEl.focus(); t.inputEl.select(); }, 0);
    });
    new Setting(this.contentEl).addButton((b) => b.setButtonText(this.button).setCta().onClick(submit));
  }
  /**
   * Empty the dialog.
   * @returns {void}
   */
  onClose() { this.contentEl.empty(); }
}

/** Yes/no dialog: shows `message`, calls `onConfirm()` if the button is pressed. */
export class ConfirmModal extends Modal {
  /**
   * @param {import("obsidian").App} app
   * @param {{heading: string, message: string, button: string}} opts texts for the dialog
   * @param {() => void} onConfirm
   */
  constructor(app, { heading, message, button }, onConfirm) {
    super(app);
    this.heading = heading;
    this.message = message;
    this.button = button;
    this.onConfirm = onConfirm;
  }
  /**
   * Build the dialog.
   * @returns {void}
   */
  onOpen() {
    this.titleEl.setText(this.heading);
    this.contentEl.createEl("p", { text: this.message });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => b.setButtonText(this.button).setCta().onClick(() => { this.close(); this.onConfirm(); }));
  }
  /**
   * Empty the dialog.
   * @returns {void}
   */
  onClose() { this.contentEl.empty(); }
}

/** Dialog to set, change or clear the due date of one TODO. */
export class DueModal extends Modal {
  /**
   * @param {import("obsidian").App} app
   * @param {{today: string, due: ?string, repeat: ?import("./core.js").Repeat, name: string}} opts
   *   today's key, the current due day and repeater, and the TODO's title (the dialog heading)
   * @param {(due: ?string, repeat: ?import("./core.js").Repeat) => void} onSubmit called with the
   *   new key (null to clear) and the repeater (null for none)
   */
  constructor(app, { today, due, repeat, name }, onSubmit) {
    super(app);
    this.today = today;
    this.startDue = due;
    this.startRepeat = repeat;
    this.name = name;
    this.onSubmit = onSubmit;
  }
  /**
   * Build the form.
   * @returns {void}
   */
  onOpen() {
    this.titleEl.setText(this.name);
    let readDue, readRepeat;
    const submit = () => {
      const due = readDue();
      if (due === undefined) return;
      this.close();
      this.onSubmit(due, due ? readRepeat() : null);
    };
    readDue = dateControls(this.contentEl, { today: this.today, initial: this.startDue, clearable: true }, submit);
    readRepeat = repeatControl(this.contentEl, this.startRepeat);
    new Setting(this.contentEl).addButton((b) => b.setButtonText("Save").setCta().onClick(submit));
  }
  /**
   * Empty the dialog.
   * @returns {void}
   */
  onClose() { this.contentEl.empty(); }
}
