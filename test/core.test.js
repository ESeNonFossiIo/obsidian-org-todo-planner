// Unit tests for src/core.js (pure TODO logic). Run with `npm test`.
import test from "node:test";
import assert from "node:assert/strict";
import { parseTodos, addTodo, setState, setDue, parseDate, parseTags, groupByDay, daySummary, isOverdue, monthGrid, addDays, activeStamp, weekDays, archiveDone, listNames, addList, toggleItem, addItem, fileLabel, archivePath, moveTodo, parseRepeat, describeRepeat, nextDate, repeatFor, completeTodo, projectRepeats, weekTitle, orgPath, deleteTodo, deleteItem, deleteList, isListName, renameTodo, renameList, hasPlannerMarker, addPlannerMarker, plannerSetting, inTaskFolder, isArchivePath, nestTodo, todoSubtree, promoteItem, reorderTodo, moveTodoToList, siblingTodo, reorderList } from "../src/core.js";

const SAMPLE = `#+TITLE: TODOs
* TODO Pay the rent                                                 :home:
  DEADLINE: <2026-11-10 Tue>
Transfer before noon.
* DONE Call mum
  CLOSED: [2026-11-07 Sat 10:12] DEADLINE: <2026-11-07 Sat>
* TODO Someday idea
* Notes
Not a todo.
* TODO Planned
  SCHEDULED: <2026-11-12 Thu>
`;

test("parseTodos reads state, title, tags, dates and body", () => {
  const t = parseTodos(SAMPLE);
  assert.equal(t.length, 4);
  assert.deepEqual(
    { line: t[0].line, state: t[0].state, title: t[0].title, tags: t[0].tags, date: t[0].date, body: t[0].body },
    { line: 1, state: "TODO", title: "Pay the rent", tags: ["home"], date: "2026-11-10", body: ["Transfer before noon."] },
  );
  assert.equal(t[1].state, "DONE");
  assert.equal(t[1].closed, "2026-11-07");
  assert.equal(t[2].date, null);
  assert.equal(t[3].scheduled, "2026-11-12");
  assert.equal(t[3].date, "2026-11-12");
});

test("a plain heading is not a TODO and ends the previous one", () => {
  const t = parseTodos(SAMPLE);
  assert.equal(t[2].end, 7);
  assert.equal(t[2].body.length, 0);
});

test("groupByDay and daySummary", () => {
  const t = parseTodos(SAMPLE);
  const g = groupByDay(t);
  assert.deepEqual([...g.byDay.keys()], ["2026-11-10", "2026-11-07", "2026-11-12"]);
  assert.equal(g.undated.length, 1);
  const s = daySummary(t, "2026-11-08");
  assert.deepEqual(s.get("2026-11-10"), { open: 1, done: 0, overdue: false });
  assert.deepEqual(s.get("2026-11-07"), { open: 0, done: 1, overdue: false });
  assert.equal(isOverdue(t[0], "2026-11-11"), true);
  assert.equal(isOverdue(t[1], "2026-11-11"), false);
});

test("addTodo appends with deadline and aligned tags", () => {
  const r = addTodo("* TODO a\n", { title: "Buy milk", due: "2026-11-09", tags: ["home", "shop"] });
  const lines = r.text.split("\n");
  assert.equal(r.line, 1);
  assert.match(lines[1], /^\* TODO Buy milk\s+:home:shop:$/);
  assert.equal(lines[1].length, 77);
  assert.equal(lines[2], "  DEADLINE: <2026-11-09 Mon>");
  assert.equal(r.text.endsWith("\n"), true);
});

test("addTodo on an empty file, no date", () => {
  assert.deepEqual(addTodo("", { title: "x" }), { text: "* TODO x\n", line: 0 });
});

test("setState DONE adds CLOSED, TODO removes it", () => {
  const done = setState(SAMPLE, 1, "DONE", new Date(2026, 10, 8, 9, 5));
  assert.match(done, /\* DONE Pay the rent/);
  assert.match(done, /  CLOSED: \[2026-11-08 Sun 09:05\] DEADLINE: <2026-11-10 Tue>\n/);
  const back = setState(done, 1, "TODO", new Date());
  assert.match(back, /^  DEADLINE: <2026-11-10 Tue>$/m);
  assert.doesNotMatch(back, /CLOSED: \[2026-11-08/);
});

test("setState on a TODO without planning line inserts one", () => {
  const out = setState(SAMPLE, 6, "DONE", new Date(2026, 10, 8, 9, 5));
  assert.match(out, /\* DONE Someday idea\n  CLOSED: \[2026-11-08 Sun 09:05\]\n/);
});

test("setDue changes, adds and clears the deadline", () => {
  assert.match(setDue(SAMPLE, 1, "2026-12-01"), /DEADLINE: <2026-12-01 Tue>/);
  assert.match(setDue(SAMPLE, 6, "2026-12-01"), /\* TODO Someday idea\n  DEADLINE: <2026-12-01 Tue>\n/);
  const cleared = setDue(SAMPLE, 1, null);
  assert.doesNotMatch(cleared, /DEADLINE: <2026-11-10/);
  assert.match(cleared, /:home:\nTransfer before noon\./);
  // keeps CLOSED and SCHEDULED
  assert.match(setDue(SAMPLE, 4, "2026-11-20"), /CLOSED: \[2026-11-07 Sat 10:12\] DEADLINE: <2026-11-20 Fri>/);
});

test("edits on a line that is not a TODO leave the text alone", () => {
  assert.equal(setDue(SAMPLE, 0, "2026-12-01"), SAMPLE);
  assert.equal(setState(SAMPLE, 8, "DONE", new Date()), SAMPLE);
});

test("parseDate", () => {
  const today = "2026-11-08"; // a Sunday
  assert.equal(parseDate("", today), null);
  assert.equal(parseDate("2026-2-3", today), "2026-02-03");
  assert.equal(parseDate("2026-02-30", today), undefined);
  assert.equal(parseDate("Today", today), today);
  assert.equal(parseDate("tomorrow", today), "2026-11-09");
  assert.equal(parseDate("+3d", today), "2026-11-11");
  assert.equal(parseDate("+2w", today), "2026-11-22");
  assert.equal(parseDate("fri", today), "2026-11-13");
  assert.equal(parseDate("sunday", today), "2026-11-15");
  assert.equal(parseDate("soon", today), undefined);
});

test("parseTags, addDays, activeStamp", () => {
  assert.deepEqual(parseTags(":a:b: c,d"), ["a", "b", "c", "d"]);
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(activeStamp("2026-11-08"), "<2026-11-08 Sun>");
});

test("archiveDone moves DONE TODOs with their body and leaves the rest", () => {
  const r = archiveDone(SAMPLE);
  assert.equal(r.count, 1);
  assert.equal(r.archived, "* DONE Call mum\n  CLOSED: [2026-11-07 Sat 10:12] DEADLINE: <2026-11-07 Sat>\n");
  assert.equal(r.text, SAMPLE.replace(r.archived, ""));
  assert.equal(parseTodos(r.text).length, 3);
});

test("archiveDone takes sub-items, keeps a DONE parent with an open child, and nothing to do is a no-op", () => {
  const t = "* DONE a\n** TODO open child\n* DONE b\nbody\n** DONE b child\n* TODO c\n";
  const r = archiveDone(t);
  assert.equal(r.text, "* DONE a\n** TODO open child\n* TODO c\n");
  assert.equal(r.archived, "* DONE b\nbody\n** DONE b child\n");
  assert.equal(r.count, 2);
  assert.deepEqual(archiveDone("* TODO x\n"), { text: "* TODO x\n", archived: "", count: 0 });
  assert.equal(archiveDone("* TODO x\n* DONE y").text, "* TODO x");
});

test("weekDays", () => {
  assert.deepEqual(weekDays("2026-11-08", true), ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]);
  assert.equal(weekDays("2026-11-08", false)[0], "2026-11-08");
  assert.equal(weekDays("2026-12-31", true)[6], "2027-01-03");
});

test("monthGrid", () => {
  const g = monthGrid(2026, 10, true); // November 2026 starts on a Sunday
  assert.deepEqual(g[0], [null, null, null, null, null, null, 1]);
  assert.equal(g.at(-1).filter(Boolean).at(-1), 30);
  assert.deepEqual(monthGrid(2026, 10, false)[0], [1, 2, 3, 4, 5, 6, 7]);
});

const LISTS = `* Shopping
** TODO milk
  DEADLINE: <2026-11-10 Tue>
  - [ ] oat
  - [X] soy
** DONE bread
* TODO solo
* Notes
Some text.
`;

test("lists: names, membership, checkbox items", () => {
  assert.deepEqual(listNames(LISTS), ["Shopping", "Notes"]);
  const t = parseTodos(LISTS);
  assert.deepEqual(t.map((x) => x.list), ["Shopping", "Shopping", null]);
  assert.deepEqual(t[0].items, [{ line: 3, checked: false, text: "oat" }, { line: 4, checked: true, text: "soy" }]);
  assert.equal(t[0].date, "2026-11-10");
  assert.equal(parseTodos("* TODO a\n** TODO b\n")[1].list, null);
});

test("addTodo into a list goes at the end of its section, creating the list if needed", () => {
  const r = addTodo(LISTS, { title: "eggs", list: "Shopping", due: "2026-11-11" });
  assert.equal(r.line, 6);
  assert.match(r.text, /\*\* DONE bread\n\*\* TODO eggs\n  DEADLINE: <2026-11-11 Wed>\n\* TODO solo/);
  const n = addTodo("* TODO a\n", { title: "x", list: "Work" });
  assert.equal(n.text, "* TODO a\n* Work\n** TODO x\n");
  assert.equal(n.line, 2);
});

test("addList is idempotent", () => {
  assert.equal(addList("* TODO a\n", "Home"), "* TODO a\n* Home\n");
  assert.equal(addList(LISTS, "Shopping"), LISTS);
});

test("toggleItem and addItem", () => {
  assert.match(toggleItem(LISTS, 3), /  - \[X\] oat\n  - \[X\] soy/);
  assert.match(toggleItem(LISTS, 4), /  - \[ \] soy/);
  assert.equal(toggleItem(LISTS, 1), LISTS);
  assert.match(addItem(LISTS, 1, "rice"), /  - \[X\] soy\n  - \[ \] rice\n\*\* DONE bread/);
  assert.match(addItem(LISTS, 6, "x"), /\* TODO solo\n  - \[ \] x\n\* Notes/);
  assert.equal(addItem(LISTS, 0, "x"), LISTS);
});

test("fileLabel and archivePath", () => {
  assert.equal(fileLabel("todo.org"), "todo");
  assert.equal(fileLabel("work/Home.ORG"), "Home");
  assert.equal(archivePath("todo.org"), "todo-archive.org");
  assert.equal(archivePath("work/home.org"), "work/home-archive.org");
  assert.equal(archivePath("notes"), "notes-archive.org");
});

test("moveTodo: top-level TODO goes to the end of the other file, with its text", () => {
  const src = "* TODO a\n  DEADLINE: <2026-11-10 Tue>\n  - [ ] x\n** TODO child\n* TODO b\n";
  const r = moveTodo(src, 0, "* TODO z\n");
  assert.equal(r.src, "* TODO b\n");
  assert.equal(r.dst, "* TODO z\n* TODO a\n  DEADLINE: <2026-11-10 Tue>\n  - [ ] x\n** TODO child\n");
  assert.equal(r.line, 1);
  assert.equal(moveTodo("* TODO a", 0, "").dst, "* TODO a\n");
});

test("moveTodo: a task in a list lands in the same list of the destination, created if missing", () => {
  const src = "* Shopping\n** TODO milk\n   - [ ] oat\n*** TODO sub\n** TODO bread\n* Work\n** TODO w\n";
  const into = moveTodo(src, 1, "* Shopping\n** TODO eggs\n\n* Other\n");
  assert.equal(into.src, "* Shopping\n** TODO bread\n* Work\n** TODO w\n");
  assert.equal(into.dst, "* Shopping\n** TODO eggs\n** TODO milk\n   - [ ] oat\n*** TODO sub\n\n* Other\n");
  const fresh = moveTodo(src, 1, "* TODO z\n");
  assert.equal(fresh.dst, "* TODO z\n* Shopping\n** TODO milk\n   - [ ] oat\n*** TODO sub\n");
});

test("moveTodo: a deeper TODO is re-levelled and a non-TODO line is refused", () => {
  const src = "* Home\n*** TODO deep\n**** TODO deeper\n";
  assert.equal(moveTodo(src, 1, "").dst, "* Home\n** TODO deep\n*** TODO deeper\n");
  assert.equal(moveTodo(src, 0, ""), null);
  assert.equal(moveTodo(src, 7, ""), null);
});

const REPEATING = `* TODO Water the plants
  DEADLINE: <2026-11-02 Mon ++1w>
  - [X] ficus
  - [ ] cactus
* TODO Once
  DEADLINE: <2026-11-02 Mon>
`;

test("repeaters are parsed, described and kept when the date is edited", () => {
  assert.deepEqual(parseRepeat("<2026-11-02 Mon .+2d>"), { type: ".+", n: 2, unit: "d" });
  assert.equal(parseRepeat("<2026-11-02 Mon>"), null);
  assert.equal(parseRepeat("<2026-11-02 Mon -2d>"), null);
  assert.equal(describeRepeat({ n: 1, unit: "w" }), "every week");
  assert.equal(describeRepeat({ n: 3, unit: "m" }), "every 3 months");
  const t = parseTodos(REPEATING);
  assert.deepEqual(t[0].repeat, { type: "++", n: 1, unit: "w" });
  assert.equal(t[1].repeat, null);
  assert.match(setDue(REPEATING, 0, "2026-12-01"), /DEADLINE: <2026-12-01 Tue \+\+1w>/);
  assert.match(setDue(REPEATING, 0, "2026-12-01", null), /DEADLINE: <2026-12-01 Tue>/);
  assert.match(setDue(REPEATING, 4, "2026-12-01", { type: "++", n: 2, unit: "w" }), /DEADLINE: <2026-12-01 Tue \+\+2w>/);
  assert.doesNotMatch(setDue(REPEATING, 0, null), /Water the plants\n  DEADLINE/);
});

test("nextDate: +, ++ and .+ and month ends", () => {
  const w = { n: 1, unit: "w" };
  assert.equal(nextDate("2026-11-02", { type: "+", ...w }, "2026-11-20"), "2026-11-09");
  assert.equal(nextDate("2026-11-02", { type: "++", ...w }, "2026-11-20"), "2026-11-23");
  assert.equal(nextDate("2026-11-02", { type: "++", ...w }, "2026-11-01"), "2026-11-09");
  assert.equal(nextDate("2026-11-02", { type: ".+", ...w }, "2026-11-20"), "2026-11-27");
  assert.equal(nextDate("2026-01-31", { type: "+", n: 1, unit: "m" }, "2026-01-31"), "2026-02-28");
  assert.equal(nextDate("2026-01-31", { type: "++", n: 1, unit: "m" }, "2026-03-01"), "2026-03-31");
  assert.equal(nextDate("2026-02-28", { type: "+", n: 1, unit: "y" }, "2026-02-28"), "2027-02-28");
});

test("repeatFor keeps the old type for the same interval and defaults to ++", () => {
  assert.deepEqual(repeatFor("1w", null), { type: "++", n: 1, unit: "w" });
  assert.deepEqual(repeatFor("1w", { type: ".+", n: 1, unit: "w" }), { type: ".+", n: 1, unit: "w" });
  assert.deepEqual(repeatFor("2w", { type: ".+", n: 1, unit: "w" }), { type: "++", n: 2, unit: "w" });
  assert.equal(repeatFor("", null), null);
  assert.equal(repeatFor("soon", null), null);
});

test("completeTodo: a repeating TODO moves on and clears its tick boxes, others are closed", () => {
  const r = completeTodo(REPEATING, 0, new Date(2026, 10, 8, 9, 0));
  assert.equal(r.next, "2026-11-09");
  assert.equal(r.text, "* TODO Water the plants\n  DEADLINE: <2026-11-09 Mon ++1w>\n  - [ ] ficus\n  - [ ] cactus\n* TODO Once\n  DEADLINE: <2026-11-02 Mon>\n");
  const o = completeTodo(REPEATING, 4, new Date(2026, 10, 8, 9, 0));
  assert.equal(o.next, null);
  assert.match(o.text, /\* DONE Once\n  CLOSED: \[2026-11-08 Sun 09:00\] DEADLINE: <2026-11-02 Mon>/);
  // a repeater on SCHEDULED only
  const s = completeTodo("* TODO x\n  SCHEDULED: <2026-11-08 Sun +1d>\n", 0, new Date(2026, 10, 8));
  assert.equal(s.next, "2026-11-09");
  assert.match(s.text, /SCHEDULED: <2026-11-09 Mon \+1d>/);
});

test("addTodo writes a repeater", () => {
  const r = addTodo("", { title: "Gym", due: "2026-11-09", repeat: { type: "++", n: 1, unit: "w" } });
  assert.equal(r.text, "* TODO Gym\n  DEADLINE: <2026-11-09 Mon ++1w>\n");
});

test("projectRepeats: later occurrences in the range, open repeating TODOs only", () => {
  const todos = parseTodos(`* TODO weekly
  DEADLINE: <2026-11-09 Mon ++1w>
* TODO overdue weekly
  DEADLINE: <2026-10-01 Thu ++1w>
* TODO monthly end
  DEADLINE: <2026-01-31 Sat +1m>
* DONE finished
  DEADLINE: <2026-11-09 Mon ++1w>
* TODO once
  DEADLINE: <2026-11-09 Mon>
* TODO undated
`);
  const got = projectRepeats(todos, "2026-11-01", "2026-11-30", "2026-11-08");
  const by = (title) => got.filter((x) => x.title === title).map((x) => x.date);
  assert.deepEqual(by("weekly"), ["2026-11-16", "2026-11-23", "2026-11-30"]);
  assert.deepEqual(by("overdue weekly"), ["2026-11-12", "2026-11-19", "2026-11-26"]);
  assert.deepEqual(by("monthly end"), ["2026-11-30"]);
  assert.equal(got.length, 7);
  assert.ok(got.every((x) => x.virtual && x.source.state === "TODO" && x.source.date !== x.date));
  assert.deepEqual(projectRepeats(todos, "2026-12-01", "2026-12-31", "2026-11-08").filter((x) => x.title === "monthly end").map((x) => x.date), ["2026-12-31"]);
  assert.equal(projectRepeats(todos, "2026-11-01", "2026-11-08", "2026-11-08").length, 0);
});

test("weekTitle", () => {
  assert.equal(weekTitle(weekDays("2026-11-08", false)), "8 Nov – 14 Nov 2026");
  assert.equal(weekTitle(weekDays("2026-12-31", true)), "28 Dec – 3 Jan 2027");
});

test("orgPath", () => {
  assert.equal(orgPath("things_to_buy"), "things_to_buy.org");
  assert.equal(orgPath("  Work.ORG "), "Work.ORG");
  assert.equal(orgPath("home", "Tasks/"), "Tasks/home.org");
  assert.equal(orgPath("sub/home", "Tasks/"), "sub/home.org");
  assert.equal(orgPath("/abs/x"), "abs/x.org");
  assert.equal(orgPath("a\\b"), "a/b.org");
  for (const bad of ["", "   ", ".org", "a//b", "../x", "a/./b", "dir/"]) assert.equal(orgPath(bad), null, bad);
});

test("deleteTodo removes the TODO with its notes, checkboxes and child headings", () => {
  const src = "* TODO a\n  DEADLINE: <2026-11-10 Tue>\n  - [ ] x\nnotes\n** TODO child\n*** DONE grandchild\n* TODO b\n";
  const r = deleteTodo(src, 0);
  assert.equal(r.text, "* TODO b\n");
  assert.equal(r.count, 3);
  const inList = deleteTodo("* Shop\n** TODO milk\n  - [ ] oat\n** TODO bread\n* Work\n", 1);
  assert.equal(inList.text, "* Shop\n** TODO bread\n* Work\n");
  assert.equal(inList.count, 1);
  assert.equal(deleteTodo("* TODO a\n* TODO b", 1).text, "* TODO a");
});

test("deleteTodo leaves the text alone for a line that is not a TODO", () => {
  const src = "* Shop\n** TODO milk\n";
  assert.deepEqual(deleteTodo(src, 0), { text: src, count: 0 });
  assert.deepEqual(deleteTodo(src, 9), { text: src, count: 0 });
});

test("deleteItem removes one checkbox line only", () => {
  const src = "* TODO a\n  - [ ] x\n  - [X] y\n  plain\n";
  assert.equal(deleteItem(src, 1), "* TODO a\n  - [X] y\n  plain\n");
  assert.equal(deleteItem(src, 2), "* TODO a\n  - [ ] x\n  plain\n");
  assert.equal(deleteItem(src, 3), src);
  assert.equal(deleteItem(src, 0), src);
  assert.equal(deleteItem(src, 40), src);
});

test("deleteList removes the list heading and everything under it", () => {
  const src = "* TODO solo\n* Shopping\n** TODO milk\n  - [ ] oat\n** DONE eggs\nnote\n\n* Work\n** TODO w\n";
  const r = deleteList(src, "Shopping");
  assert.equal(r.text, "* TODO solo\n* Work\n** TODO w\n");
  assert.equal(r.count, 2);
  assert.equal(deleteList(src, "Work").text, "* TODO solo\n* Shopping\n** TODO milk\n  - [ ] oat\n** DONE eggs\nnote\n\n");
  assert.deepEqual(deleteList(src, "Nope"), { text: src, count: 0 });
  assert.deepEqual(deleteList(src, "solo"), { text: src, count: 0 });   // a TODO is not a list
  assert.equal(deleteList("* Empty\n* TODO a\n", "Empty").text, "* TODO a\n");
  assert.equal(deleteList("* A\n** TODO x\n* B\n* A\n** TODO y\n", "A").text, "* B\n");
});

test("renameTodo keeps state, depth, tags, date and body", () => {
  const src = "* TODO Pay rent                                                    :home:\n  DEADLINE: <2026-11-10 Tue>\n  - [ ] x\n** DONE old\n";
  const r = renameTodo(src, 0, "  Pay the rent in full ");
  const lines = r.split("\n");
  assert.match(lines[0], /^\* TODO Pay the rent in full\s+:home:$/);
  assert.equal(lines[0].length, 77);
  assert.equal(lines.slice(1).join("\n"), src.split("\n").slice(1).join("\n"));
  assert.equal(renameTodo(src, 3, "new"), src.replace("** DONE old", "** DONE new"));
});

test("renameTodo refuses titles that would not read back", () => {
  const src = "* TODO a\n** Plain\n";
  assert.equal(renameTodo(src, 0, ""), src);
  assert.equal(renameTodo(src, 0, "   "), src);
  assert.equal(renameTodo(src, 0, "two\nlines"), src);
  assert.equal(renameTodo(src, 0, "Buy :milk:"), src);   // would turn into a tag
  assert.equal(renameTodo(src, 1, "x"), src);            // not a TODO
  assert.equal(renameTodo(src, 7, "x"), src);
});

test("isListName and renameList", () => {
  assert.equal(isListName("Groceries"), true);
  for (const bad of ["", "  ", "TODO x", "DONE", "a :tag:", "a\nb"]) assert.equal(isListName(bad), false, bad);
  const src = "* TODO solo\n* Shopping                                                        :x:\n** TODO milk\n* Work\n";
  const r = renameList(src, "Shopping", " Groceries ");
  assert.match(r.text.split("\n")[1], /^\* Groceries\s+:x:$/);
  assert.equal(r.text.split("\n")[1].length, 77);
  assert.equal(r.count, 1);
  assert.deepEqual(parseTodos(r.text).map((x) => x.list), [null, "Groceries"]);
  assert.deepEqual(renameList(src, "Nope", "A"), { text: src, count: 0 });
  assert.deepEqual(renameList(src, "Work", "Work"), { text: src, count: 0 });
  assert.deepEqual(renameList(src, "Work", "TODO x"), { text: src, count: 0 });
  assert.equal(renameList("* A\n* B\n* A\n", "A", "C").text, "* C\n* B\n* C\n");
});

test("hasPlannerMarker looks only at the header", () => {
  assert.equal(hasPlannerMarker("#+TITLE: x\n#+PLANNER: tasks\n* TODO a\n"), true);
  assert.equal(hasPlannerMarker("#+planner: Tasks\n"), true);
  assert.equal(hasPlannerMarker("#+PLANNER:\n* TODO a\n"), true);
  assert.equal(hasPlannerMarker("#+TITLE: x\n\n#+PLANNER: tasks\n* a\n"), true);
  assert.equal(hasPlannerMarker("* TODO a\n#+PLANNER: tasks\n"), false);
  assert.equal(hasPlannerMarker("#+TITLE: x\n* a\n"), false);
  assert.equal(hasPlannerMarker(""), false);
  for (const off of ["off", "No", "FALSE", "text", "0"]) assert.equal(hasPlannerMarker(`#+PLANNER: ${off}\n`), false, off);
});

test("addPlannerMarker adds the line after the header keywords", () => {
  assert.equal(addPlannerMarker(""), "#+PLANNER: tasks\n");
  assert.equal(addPlannerMarker("* TODO a\n"), "#+PLANNER: tasks\n* TODO a\n");
  assert.equal(addPlannerMarker("#+TITLE: x\n#+STARTUP: overview\n* a\n"), "#+TITLE: x\n#+STARTUP: overview\n#+PLANNER: tasks\n* a\n");
  assert.equal(addPlannerMarker("#+PLANNER: off\n* a\n"), "#+PLANNER: tasks\n* a\n");
  const done = "#+PLANNER: tasks\n* a\n";
  assert.equal(addPlannerMarker(done), done);
});

test("plannerSetting tells yes, no and nothing apart", () => {
  assert.equal(plannerSetting("#+PLANNER: tasks\n* a\n"), true);
  assert.equal(plannerSetting("#+PLANNER: off\n* a\n"), false);
  assert.equal(plannerSetting("#+TITLE: x\n* a\n"), null);
  assert.equal(plannerSetting("* a\n#+PLANNER: off\n"), null);
});

test("inTaskFolder: .org files below a folder, archives excepted", () => {
  const f = ["Tasks", "/Work/lists/"];
  assert.equal(inTaskFolder("Tasks/home.org", f), true);
  assert.equal(inTaskFolder("Tasks/sub/deep.ORG", f), true);
  assert.equal(inTaskFolder("Work/lists/a.org", f), true);
  assert.equal(inTaskFolder("Tasks/home-archive.org", f), false);
  assert.equal(inTaskFolder("Tasks/notes.md", f), false);
  assert.equal(inTaskFolder("TasksExtra/home.org", f), false);
  assert.equal(inTaskFolder("home.org", f), false);
  assert.equal(inTaskFolder("Tasks/home.org", ["", "  ", "/"]), false);
  assert.equal(inTaskFolder("Tasks/home.org", []), false);
  assert.equal(isArchivePath("a/b-archive.org"), true);
});

test("nestTodo: a task becomes a checkbox item of another, in either direction", () => {
  const after = nestTodo("* TODO a\n* TODO b\n", 2 - 1, 0);   // b into a (b is after a)
  assert.deepEqual(after, { text: "* TODO a\n  - [ ] b\n", loss: [] });
  const before = nestTodo("* TODO a\n* TODO b\n", 0, 1);       // a into b (a is before b)
  assert.deepEqual(before, { text: "* TODO b\n  - [ ] a\n", loss: [] });
  const withItems = nestTodo("* TODO a\n  - [ ] x\n  - [X] y\n* TODO b\n* TODO c\n", 3, 0);
  assert.equal(withItems.text, "* TODO a\n  - [ ] x\n  - [X] y\n  - [ ] b\n* TODO c\n");
});

test("nestTodo keeps notes, items, state and sub-TODOs as nested items and reports what is lost", () => {
  const src = "* TODO a\n* DONE b                                                                :t:\n  DEADLINE: <2026-11-10 Tue ++1w>\n  - [ ] x\n  - [X] y\nnote line\n** TODO c\n   - [ ] z\n*** DONE d\n* TODO e\n";
  const r = nestTodo(src, 1, 0);
  assert.equal(r.text, "* TODO a\n  - [X] b\n    - [ ] x\n    - [X] y\n    note line\n    - [ ] c\n      - [ ] z\n      - [X] d\n* TODO e\n");
  assert.deepEqual(r.loss, ["due date", "repeat", "tags"]);
  assert.deepEqual(parseTodos(r.text).map((x) => x.title), ["a", "e"]);
});

test("nestTodo inside a list and refusals", () => {
  const src = "* Shop\n** TODO milk\n** TODO bread\n* TODO a\n** TODO child\n";
  assert.equal(nestTodo(src, 2, 1).text, "* Shop\n** TODO milk\n  - [ ] bread\n* TODO a\n** TODO child\n");
  assert.equal(nestTodo(src, 3, 4), null);            // into its own sub-TODO
  assert.equal(nestTodo(src, 1, 1), null);            // into itself
  assert.equal(nestTodo(src, 0, 1), null);            // a list heading is not a TODO
  assert.equal(nestTodo(src, 1, 0), null);
  assert.equal(nestTodo(src, 99, 1), null);
  // a parent made a sub-item of a task before it; its sub-TODO is the target slot's neighbour
  assert.equal(nestTodo("* TODO p\n** TODO c\n* TODO q\n", 2, 0).text, "* TODO p\n  - [ ] q\n** TODO c\n");
});

test("todoSubtree", () => {
  const src = "* Shop\n** TODO milk\n  - [ ] x\n*** TODO sub\n** TODO bread\n";
  assert.deepEqual(todoSubtree(src, 1), { start: 1, end: 4 });
  assert.equal(todoSubtree(src, 0), null);
});

test("promoteItem: an item becomes a task at the end of the file, or of a list", () => {
  const src = "* TODO a\n  - [ ] x\n  - [X] y\n* TODO b\n";
  const r = promoteItem(src, 0, 1);
  assert.equal(r.text, "* TODO a\n  - [X] y\n* TODO b\n* TODO x\n");
  assert.equal(r.line, 3);
  const shop = "* Shop\n** TODO milk\n  - [ ] oat\n** TODO bread\n* Work\n** TODO w\n";
  assert.equal(promoteItem(shop, 1, 2, { list: "Shop" }).text, "* Shop\n** TODO milk\n** TODO bread\n** TODO oat\n* Work\n** TODO w\n");
  assert.equal(promoteItem(shop, 1, 2, { list: "Work" }).text, "* Shop\n** TODO milk\n** TODO bread\n* Work\n** TODO w\n** TODO oat\n");
  assert.equal(promoteItem(shop, 1, 2, { list: "New" }).text, "* Shop\n** TODO milk\n** TODO bread\n* Work\n** TODO w\n* New\n** TODO oat\n");
  assert.equal(promoteItem(shop, 1, 2, { list: null }).text, "* Shop\n** TODO milk\n** TODO bread\n* Work\n** TODO w\n* TODO oat\n");
});

test("promoteItem: due date, ticked items, and nested items and notes come along", () => {
  const dated = promoteItem("* TODO a\n  - [ ] x\n", 0, 1, { due: "2026-11-12" });
  assert.equal(dated.text, "* TODO a\n* TODO x\n  DEADLINE: <2026-11-12 Thu>\n");
  const done = promoteItem("* TODO a\n  - [X] y\n", 0, 1, { now: new Date(2026, 10, 8, 9, 0) });
  assert.equal(done.text, "* TODO a\n* DONE y\n  CLOSED: [2026-11-08 Sun 09:00]\n");
  const nested = promoteItem("* TODO a\n  - [ ] p\n    - [ ] c1\n    - [X] c2\n    a note\n  - [ ] q\n", 0, 1);
  assert.equal(nested.text, "* TODO a\n  - [ ] q\n* TODO p\n  - [ ] c1\n  - [X] c2\n  a note\n");
  assert.deepEqual(parseTodos(nested.text).map((x) => [x.title, x.items.length]), [["a", 1], ["p", 2]]);
});

test("promoteItem refuses lines that are not an item of that TODO, and undoes nestTodo", () => {
  const src = "* TODO a\n  - [ ] x\n  plain\n* TODO b\n  - [ ] z\n";
  assert.equal(promoteItem(src, 0, 0), null);     // the heading
  assert.equal(promoteItem(src, 0, 2), null);     // not a checkbox
  assert.equal(promoteItem(src, 0, 4), null);     // belongs to another TODO
  assert.equal(promoteItem(src, 1, 1), null);     // not a TODO heading
  assert.equal(promoteItem("* TODO a\n  - [ ]\n", 0, 1), null);   // no text
  const nested = nestTodo("* TODO a\n* TODO b\n", 1, 0).text;     // b becomes an item of a ...
  assert.equal(promoteItem(nested, 0, 1).text, "* TODO a\n* TODO b\n");   // ... and back
});

const ORDER = "* TODO a\n  - [ ] x\n* TODO b\n  DEADLINE: <2026-11-10 Tue>\n* TODO c\n";

test("reorderTodo moves a task, with its text, before or after another", () => {
  assert.equal(reorderTodo(ORDER, 4, 0, "before"), "* TODO c\n* TODO a\n  - [ ] x\n* TODO b\n  DEADLINE: <2026-11-10 Tue>\n");
  assert.equal(reorderTodo(ORDER, 0, 4, "after"), "* TODO b\n  DEADLINE: <2026-11-10 Tue>\n* TODO c\n* TODO a\n  - [ ] x\n");
  assert.equal(reorderTodo(ORDER, 0, 2, "after"), "* TODO b\n  DEADLINE: <2026-11-10 Tue>\n* TODO a\n  - [ ] x\n* TODO c\n");
  assert.equal(reorderTodo(ORDER, 2, 0, "before"), "* TODO b\n  DEADLINE: <2026-11-10 Tue>\n* TODO a\n  - [ ] x\n* TODO c\n");
  assert.equal(reorderTodo(ORDER, 0, 2, "before"), ORDER, "dropping in place changes nothing");
  assert.equal(reorderTodo(ORDER, 2, 0, "after"), ORDER, "also in place");
  assert.equal(reorderTodo("* TODO a\n* TODO b", 0, 1, "after"), "* TODO b\n* TODO a", "keeps a missing final newline");
});

test("reorderTodo takes the target's depth and list, moves sub-TODOs along, and refuses nonsense", () => {
  const src = "* TODO top\n  DEADLINE: <2026-11-10 Tue>\n** TODO child\n* Shop\n** TODO milk\n** TODO bread\n* Work\n** TODO w\n";
  const into = reorderTodo(src, 0, 5, "before");   // top-level task, dropped before bread
  assert.equal(into, "* Shop\n** TODO milk\n** TODO top\n  DEADLINE: <2026-11-10 Tue>\n*** TODO child\n** TODO bread\n* Work\n** TODO w\n");
  assert.deepEqual(parseTodos(into).map((x) => [x.title, x.list]), [["milk", "Shop"], ["top", "Shop"], ["child", "Shop"], ["bread", "Shop"], ["w", "Work"]]);
  const out = reorderTodo(src, 4, 0, "after");     // a list task dropped after the top-level one
  assert.equal(out.split("\n").slice(0, 4).join("|"), "* TODO top|  DEADLINE: <2026-11-10 Tue>|** TODO child|* TODO milk");
  assert.equal(reorderTodo(src, 0, 2, "before"), null, "into its own sub-task");
  assert.equal(reorderTodo(src, 0, 0, "before"), null, "onto itself");
  assert.equal(reorderTodo(src, 3, 0, "before"), null, "a list heading is not a task");
  assert.equal(reorderTodo(src, 0, 3, "after"), null);
});

test("moveTodoToList moves a task to the end of a list or out of any list", () => {
  const src = "* TODO a\n  - [ ] x\n* Shop\n** TODO milk\n* Work\n** TODO w\n";
  assert.equal(moveTodoToList(src, 0, "Shop"), "* Shop\n** TODO milk\n** TODO a\n  - [ ] x\n* Work\n** TODO w\n");
  assert.equal(moveTodoToList(src, 3, null), "* TODO a\n  - [ ] x\n* Shop\n* Work\n** TODO w\n* TODO milk\n");
  assert.equal(moveTodoToList(src, 3, "Work"), "* TODO a\n  - [ ] x\n* Shop\n* Work\n** TODO w\n** TODO milk\n");
  assert.equal(moveTodoToList(src, 0, "New"), "* Shop\n** TODO milk\n* Work\n** TODO w\n* New\n** TODO a\n  - [ ] x\n");
  assert.equal(moveTodoToList(src, 2, "Shop"), null);
});

test("siblingTodo finds the neighbour to swap with", () => {
  const src = "* TODO a\n* DONE d\n* TODO b\n* Shop\n** TODO m1\n** DONE m2\n** TODO m3\n*** TODO sub\n* TODO z\n";
  assert.equal(siblingTodo(src, 2, -1), 0, "up skips done tasks");
  assert.equal(siblingTodo(src, 0, 1), 2, "down skips done tasks");
  assert.equal(siblingTodo(src, 0, -1), null, "first of the file");
  assert.equal(siblingTodo(src, 2, 1), null, "the next list heading ends the search");
  assert.equal(siblingTodo(src, 4, 1), 6);
  assert.equal(siblingTodo(src, 6, -1), 4);
  assert.equal(siblingTodo(src, 6, 1), null, "last task of the list");
  assert.equal(siblingTodo(src, 7, -1), null, "a lone sub-TODO has no sibling");
  assert.equal(siblingTodo(src, 8, -1), null, "a list heading stops it going up into the list");
  assert.equal(siblingTodo(src, 3, 1), null, "not a task");
});

test("reorderList moves a list section, with all its tasks, before or after another", () => {
  const src = "* TODO solo\n* Shop\n** TODO milk\n  - [ ] oat\n\n* Work\n** TODO w\n* TODO mid\n* Home\n** TODO h\n";
  assert.equal(reorderList(src, "Home", "Shop", "before"), "* TODO solo\n* Home\n** TODO h\n* Shop\n** TODO milk\n  - [ ] oat\n\n* Work\n** TODO w\n* TODO mid\n");
  assert.equal(reorderList(src, "Shop", "Home", "after"), "* TODO solo\n* Work\n** TODO w\n* TODO mid\n* Home\n** TODO h\n* Shop\n** TODO milk\n  - [ ] oat\n\n");
  assert.equal(reorderList(src, "Work", "Shop", "before"), "* TODO solo\n* Work\n** TODO w\n* Shop\n** TODO milk\n  - [ ] oat\n\n* TODO mid\n* Home\n** TODO h\n");
  assert.equal(reorderList(src, "Shop", "Work", "after"), "* TODO solo\n* Work\n** TODO w\n* Shop\n** TODO milk\n  - [ ] oat\n\n* TODO mid\n* Home\n** TODO h\n");
  assert.equal(reorderList(src, "Work", "Shop", "after"), src, "dropping in place changes nothing");
  assert.deepEqual(parseTodos(reorderList(src, "Home", "Shop", "before")).map((x) => [x.title, x.list]), [["solo", null], ["h", "Home"], ["milk", "Shop"], ["w", "Work"], ["mid", null]]);
});

test("reorderList refuses missing or identical lists and keeps a missing final newline", () => {
  const src = "* A\n* B\n* TODO t";
  assert.equal(reorderList(src, "A", "A", "before"), null);
  assert.equal(reorderList(src, "A", "Nope", "before"), null);
  assert.equal(reorderList(src, "t", "A", "before"), null);   // a task is not a list
  assert.equal(reorderList(src, "A", "B", "after"), "* B\n* A\n* TODO t");
  assert.equal(reorderList("* A\n** TODO x\n* B", "A", "B", "after"), "* B\n* A\n** TODO x");
});
