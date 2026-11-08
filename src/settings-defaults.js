/**
 * Default plugin settings:
 *   files         paths of the TODO files inside the vault (each is labelled by its name)
 *   taskFolders   vault folders whose `.org` files are all TODO files (and open as tasks)
 *   openAsTasks   open a TODO file (listed in `files` or in a task folder), or a file whose header
 *                 has `#+PLANNER: tasks`, as tasks instead of text (`#+PLANNER: off` wins)
 *   mondayFirst   calendar weeks start on Monday
 *   showDone      list completed TODOs (struck through) in the day list
 *   tagsColumn    column where a heading's :tags: end (Org's default is 77)
 *   plannerMode   "month" or "week": what the planner pane shows now (remembered)
 *   defaultView   "month", "week" or "last": what a newly opened planner pane starts in;
 *                 "last" keeps whatever plannerMode was left at
 *   tasksMode     "lists" or "week": what the Tasks pane shows (remembered)
 *   panePlacement where the planner and tasks panes open: "auto" (main area on mobile,
 *                 right sidebar on desktop), "sidebar" or "main"
 */
export const DEFAULTS = { files: ["todo.org"], taskFolders: [], openAsTasks: true, mondayFirst: true, showDone: true, tagsColumn: 77, plannerMode: "month", defaultView: "last", tasksMode: "lists", panePlacement: "auto" };
