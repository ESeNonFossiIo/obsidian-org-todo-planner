// The plugin's settings tab. Every change is saved at once; settings that affect
// the planner also redraw it.
import { PluginSettingTab, Setting } from "obsidian";
import { DEFAULTS } from "./settings-defaults.js";

/** Settings tab; reads and writes `plugin.settings` (defaults in settings-defaults.js). */
export class TodoPlannerSettings extends PluginSettingTab {
  /**
   * @param {import("obsidian").App} app
   * @param {import("./main.js").default} plugin whose `settings` this tab edits
   */
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  /**
   * Build the settings form. Each control saves immediately.
   * @returns {void}
   */
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName("TODO files")
      .setDesc("One path per line, inside the vault, e.g. home.org and work.org. Each file is shown under its name, and its completed TODOs are archived to <name>-archive.org. A file is created when you add its first TODO.")
      .addTextArea((t) => {
        t.setValue(this.plugin.settings.files.join("\n")).onChange(async (v) => {
          const list = [...new Set(v.split("\n").map((l) => l.trim()).filter(Boolean))];
          this.plugin.settings.files = list.length ? list : DEFAULTS.files.slice();
          await this.plugin.saveSettings();
          this.plugin.filesChanged();
        });
        t.inputEl.rows = 4;
      });
    new Setting(containerEl).setName("Task folders")
      .setDesc("Optional, one vault folder per line, e.g. Tasks. Every .org file in these folders (and below) is a TODO file, so adding a file there is enough, and it opens as tasks. Archive files (<name>-archive.org) are skipped, and a file whose header says #+PLANNER: off stays a text file. New files from \"+ New file\" are created in the first folder.")
      .addTextArea((t) => {
        t.setValue(this.plugin.settings.taskFolders.join("\n")).onChange(async (v) => {
          this.plugin.settings.taskFolders = v.split("\n").map((l) => l.trim()).filter(Boolean);
          await this.plugin.saveSettings();
          this.plugin.filesChanged();
        });
        t.inputEl.rows = 3;
      });
    new Setting(containerEl).setName("Open TODO files as tasks")
      .setDesc("When you open one of your TODO files (listed above or in a task folder), or any .org file whose header has #+PLANNER: tasks, show it as tasks instead of text. A file with #+PLANNER: off in its header always stays text. Use \"Edit as text\" in the tab's header to see the raw file; \"Open as tasks\" in the file menu goes the other way.")
      .addToggle((t) => t.setValue(this.plugin.settings.openAsTasks).onChange(async (v) => {
        this.plugin.settings.openAsTasks = v;
        await this.plugin.saveSettings();
        this.plugin.recheckLeaves();
      }));
    new Setting(containerEl).setName("Week starts on Monday")
      .addToggle((t) => t.setValue(this.plugin.settings.mondayFirst).onChange(async (v) => {
        this.plugin.settings.mondayFirst = v;
        await this.plugin.saveSettings();
        this.plugin.refreshViews();
      }));
    new Setting(containerEl).setName("Open panes in")
      .setDesc("Where the planner and tasks panes open. \"Automatic\" uses the main area on mobile (easier to reach than the swipe-in sidebar) and the right sidebar on desktop.")
      .addDropdown((d) => d.addOptions({ auto: "Automatic", sidebar: "Right sidebar", main: "Main area" })
        .setValue(this.plugin.settings.panePlacement).onChange(async (v) => {
          this.plugin.settings.panePlacement = v;
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl).setName("Default view")
      .setDesc("What the planner shows when it opens. \"Last used\" keeps the view you switched to.")
      .addDropdown((d) => d.addOptions({ last: "Last used", month: "Month", week: "Week" })
        .setValue(this.plugin.settings.defaultView).onChange(async (v) => {
          this.plugin.settings.defaultView = v;
          if (v !== "last") this.plugin.settings.plannerMode = v;
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
        }));
    new Setting(containerEl).setName("Show completed TODOs")
      .setDesc("List done TODOs, struck through, under the day they were due.")
      .addToggle((t) => t.setValue(this.plugin.settings.showDone).onChange(async (v) => {
        this.plugin.settings.showDone = v;
        await this.plugin.saveSettings();
        this.plugin.refreshViews();
      }));
    new Setting(containerEl).setName("Tags column").setDesc("Right edge for :tags: on new TODOs (Emacs default 77).")
      .addText((t) => t.setValue(String(this.plugin.settings.tagsColumn)).onChange(async (v) => {
        const n = parseInt(v, 10);
        if (n > 0) { this.plugin.settings.tagsColumn = n; await this.plugin.saveSettings(); }
      }));
  }
}
