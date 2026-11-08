# Publishing checklist

How to get Org Todo Planner from this folder to Obsidian's community plugin list. Tick things off as you
go. Target repo: `ESeNonFossiIo/obsidian-org-todo-planner` (default branch `master`, MIT licensed).

## 0. Already done

- [x] `LICENSE` (MIT), `README.md` with a Quick start, the Org Reader requirement, features, commands,
      settings, Mobile and Install sections
- [x] `manifest.json` complete (`id`, `name`, `version`, `minAppVersion`, `description`, `author`,
      `authorUrl`, `isDesktopOnly: false`); the description is under 250 characters
- [x] No Node or Electron APIs, no network requests, no `innerHTML`, no debug logging, no inline styles
- [x] No personal data in the repo: no vault files, `data.json` and `.deploy-target` are gitignored, the
      screenshots use made-up sample data
- [x] Unit tests (`npm test`), build (`npm run build`) and three workflows: `ci.yml` (tests + build on every
      push and pull request), `package.yml` (a zip artifact of every build), `release.yml` (builds, tests,
      attests and publishes a GitHub release when you push a tag)
- [x] The plugin id `org-todo-planner` is not used by any plugin in the community list
- [x] Its one dependency, Org Reader, is already in the community list

## 1. Before the first commit

- [ ] **Git identity.** This repo would commit as your global identity. Your other plugins show
      `ESeNonFossiIo`; if you want the same here, set it locally first:
      ```
      git config user.name ESeNonFossiIo
      git config user.email <your-github-noreply-address>
      ```
- [ ] **Retake the screenshots in real Obsidian.** The ones in `screenshots/` were rendered in a browser
      harness with Obsidian-like colours, so they differ slightly from the real thing. Replace at least
      `planner-month.png`, `tasks.png` and `file-tasks.png` (same file names, no README change needed).
      Use a throw-away vault with sample data, not your own.
- [ ] **Try it on your phone** (the README says it works on mobile): the Tasks pane, adding a task, the
      date picker, the task menu (**⋯**), *Move up* / *Move down*, *Make a sub-item of…*, the ribbon menu.
- [ ] **Try the drag features on the desktop:** a task before/after another, onto a list tab, onto a
      week-mode day; a task onto the middle of another (sub-item); a sub-item out onto a list. Only list-tab
      dragging has been confirmed in real Obsidian so far.
- [ ] `npm test && npm run build` are green; `git status` shows nothing you don't want published.

## 2. Create the repository and push

- [ ] On GitHub: new **public** repository `obsidian-org-todo-planner` under `ESeNonFossiIo`, without a
      README, licence or `.gitignore` (they are already here).
- [ ] Repository settings: set the description and topics (see the end of this file), enable Issues.
- [ ] First commit and push (`master`):
      ```
      git add .
      git commit -m "Initial release"
      git remote add origin git@github.com:ESeNonFossiIo/obsidian-org-todo-planner.git
      git push -u origin master
      ```
- [ ] Wait for the **CI** workflow to go green (Actions tab). If it fails, fix and push again.
- [ ] Add the CI badge under the README title (the workflow only exists once the repo does):
      ```
      [![CI](https://github.com/ESeNonFossiIo/obsidian-org-todo-planner/actions/workflows/ci.yml/badge.svg)](https://github.com/ESeNonFossiIo/obsidian-org-todo-planner/actions/workflows/ci.yml)
      ```

## 3. First release

Obsidian installs the **latest GitHub release**, and the tag must be **exactly the `manifest.json`
version, with no `v`** (currently `0.1.0`); the release workflow fails otherwise.

- [ ] On `master`, with CI green:
      ```
      git tag 0.1.0
      git push origin 0.1.0
      ```
- [ ] Wait for the **Release** workflow, then check that the release has `main.js`, `manifest.json` and
      `styles.css` attached: `gh release view 0.1.0` (or look at the Releases page)
- [ ] If the release is wrong, delete it and the tag (`gh release delete 0.1.0 --cleanup-tag`), fix the
      problem, and tag again

## 4. Test the release

- [ ] Install the **BRAT** plugin (desktop and Android), add `ESeNonFossiIo/obsidian-org-todo-planner`
- [ ] In a fresh test vault with Org Reader enabled: add a task (it creates `todo.org`), give it a due date,
      open the planner, open `todo.org` from the file explorer (it should open as tasks), use **Edit as
      text**, create a list and a second file, archive a done task
- [ ] Confirm it behaves like your local copy, on desktop and on the phone
- [ ] Run **Why does this file open as text? (diagnose)** once to check that command works

## 5. Submit to the community list

1. [ ] Fork `obsidianmd/obsidian-releases`
2. [ ] Add this entry at the **end** of `community-plugins.json` (`id`, `name` and `description` must match
       `manifest.json` exactly; if you change the manifest description, change it here too):
   ```json
   {
     "id": "org-todo-planner",
     "name": "Org Todo Planner",
     "author": "ESeNonFossiIo",
     "description": "Manage TODOs in Org files: calendar and week view, due dates, repeating tasks, lists and sub-items, with drag and drop. Requires the Org Reader plugin.",
     "repo": "ESeNonFossiIo/obsidian-org-todo-planner"
   }
   ```
3. [ ] Open a pull request with their template, title `Add plugin: Org Todo Planner`, and tick its checklist;
       a bot validates the entry and the release (manifest, tag, assets, licence)
4. [ ] A human reviews it (can take weeks). Likely questions, with the answers:
       - *Depends on another plugin?* Yes, Org Reader (in the community list) provides the `.org` editor
         view; the README says so at the top, and without it the panes still add, tick and reschedule
         tasks, and "Open in file" shows a notice.
       - *Writes to files?* Only the `.org` files you configure (and their `-archive.org`), through
         `vault.process`, or through Org Reader's editor when the file is open there.
       - *Network, telemetry, desktop-only APIs?* None.
5. [ ] Answer review comments by pushing changes and tagging a new release (see below)

## 6. After approval: releasing updates

`npm version` does the bookkeeping. From an up-to-date `master` with a clean tree:

```
npm version 0.1.1        # tests, bumps manifest.json + versions.json, commits, tags 0.1.1, pushes
```

(The `preversion` script refuses to run unless `HEAD` equals `origin/master` and the tests pass.) The tag
triggers the Release workflow. No new pull request to `obsidian-releases` is needed; Obsidian reads the
latest release. Raise `minAppVersion` in `manifest.json` only when you start using a newer Obsidian API.

## GitHub description and topics

Repository description (the "About" box):

> Obsidian plugin to manage TODOs in plain Org files: calendar and week view, due dates, repeating tasks, lists and sub-items, drag and drop. Needs Org Reader.

Topics: `obsidian-plugin`, `obsidian`, `org-mode`, `orgmode`, `todo`, `task-management`, `calendar`, `gtd`
