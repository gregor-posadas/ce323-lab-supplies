# CE 323 Lab Supplies

An inventory site for the CE 323 Environmental and Fluids Laboratory at Boise State. It tracks what's on the shelf and checks each scheduled lab session against it. It works out when to order, given that Hach can take 3 to 5 weeks, and builds the order list for the department. It was made so that no section runs out of a reagent halfway through a lab.

- **Website:** plain HTML, CSS and JavaScript, served by GitHub Pages. No build step.
- **Data:** a Google Sheet, "CE 323 Lab Supplies data". Counts, orders, the schedule and contacts live there, not in this repository.
- **Backend:** a Google Apps Script web app attached to that Sheet. It reads and writes the Sheet and sends a short Monday email when something needs doing.
- **Font:** Atkinson Hyperlegible Next, under the SIL Open Font License (`fonts/OFL.txt`).

Until the backend is connected, the site runs in **practice mode**. It uses the starting data in `data/seed.json`, and any changes stay in that browser, so it is safe to try anything.

## What the TAs do

1. **Monday:** open **This week**. Each upcoming lab session shows **Ready**, **Short** or **Check counts**. The Monday email says the same thing.
2. **If something is short:** open the session and press **Add the missing supplies to the order list**. On **Orders**, press **Copy as an email** and send it to the department's ordering contact. Mark items **ordered**.
3. **Before each lab:** open the session's **pick list** and pull everything from the shelf.
4. **After each lab:** on the same page, **record what was used**. The planned amounts are pre-filled, so this takes a few seconds and keeps the counts right.
5. **When a box arrives:** **Mark received** on Orders. Chemicals go to EHS for a barcode before they go on the shelf.
6. **Monthly and at the start of each semester:** a full **Count**. Counts older than 60 days are flagged.

The **Guide** page explains all of this for someone new to environmental engineering, including what each reagent is for, a glossary and the safety basics.

## How the readiness check works

Each lab has a supply list with two kinds of lines:

- **Used up, per section**: e.g. 3 bromphenol blue pillows per section. This is multiplied by the number of sections.
- **Must be on the shelf**: e.g. at least one opened titrator cartridge or one bottle of indicator. It isn't used up, but the lab can't run without it.

The site goes through the scheduled sessions in date order and takes each session's share out of the stock. If a later session that uses the same supply will come up short, the site flags that session. Each vendor has a lead time (Hach 35 days, Fisher 14, Amazon 5, editable per supply), so the site can give an **order by** date. A supply that has never been counted shows **Check counts** instead of guessing.

The starting per-section amounts come from the lab's Fall 2026 inventory sheet, which gives semester totals for 3 tests per lab and 4 sections. These totals were divided by 4. Change any lab's supply list when real use turns out different.

## Set up the backend (about 15 minutes, once)

Use the Google account that should own the lab's data long-term, such as Dr. Miller's or a department lab account. Avoid the account of a student who will graduate.

1. In Google Drive, create a blank Google Sheet named **CE 323 Lab Supplies data**.
2. Go to **Extensions > Apps Script**. Replace `Code.gs` with `apps-script/Code.gs` from this repository.
3. Add a second script file (**+ > Script**) named `Logic`, and paste in `assets/logic.js`. Both the site and the backend use these same rules.
4. Click the gear (**Project Settings**), tick **Show "appsscript.json" manifest file in editor**, then replace `appsscript.json` with `apps-script/appsscript.json`. Save.
5. Pick `setup` in the function menu and click **Run**. Approve the permissions (this Sheet, fetching the starting list, sending the Monday email).
   - Open **Execution log** to see the two codes. The **lab code** is for the TAs. The **admin code** is only needed to delete supplies, labs or equipment.
   - Lost them? They're under **Project Settings > Script properties** (`LAB_CODE`, `ADMIN_CODE`).
6. In the Sheet's **Settings** tab, fill in:
   - `siteUrl`: the GitHub Pages address of this site.
   - `reminderEmails`: the TAs' emails, comma separated, for the Monday summary.
   - `orderContactName` / `orderContactEmail`: who places orders for the department. The **Copy as an email** button addresses the email to this person.
   - `instructorEmail`, `ehsContactName`, `ehsContactEmail`: shown on the Guide page.
7. Pick `importSeed` and **Run**. This copies the starting supply list, labs and equipment into the Sheet. It only fills empty tabs, so running it again is harmless.
8. **Deploy > New deployment**, type **Web app**, **Execute as: Me**, **Who has access: Anyone**, then **Deploy**. Copy the URL that ends in `/exec`.
9. In this repository, paste that URL into `apiUrl` in `assets/config.js`, run `sh scripts/stamp-version.sh`, and commit. The site switches from practice mode to the Sheet.
10. Give the TAs the site link and the lab code. The first time they open the site, it asks for the code and their first name.

When you change `Code.gs` or `assets/logic.js` later, paste the new version into Apps Script. Then use **Deploy > Manage deployments > Edit > New version**, so the `/exec` URL stays the same.

### If "Anyone" isn't offered

Some university Google Workspace accounts only allow web apps for people signed in to that university. A GitHub Pages site can't use a backend like that, because the browser doesn't pass a Google sign-in from one site to another. In that case, do steps 1 to 8 from a personal Google account, and share the Sheet with Dr. Miller and the TAs. You can also ask for a version of the site that is served from Apps Script itself. Don't choose a narrower access option; the site won't be able to reach it.

## Editing the Sheet directly

Each tab is a plain table, and hand edits show up the next time someone loads the site. All cells are stored as text.

- **Items:** `onHand` is in the item's `unit`. Leave it empty if the item hasn't been counted. `perOrderUnit` is how many units come in one `orderUnit` (e.g. 100 pillows in a pack of 100). `chemical` is `yes` or empty. Dates are `YYYY-MM-DD`.
- **Usage:** one row per supply per lab. `kind` is `use` (amount per section) or `keep` (minimum on the shelf).
- **Sessions:** `status` is `planned` or `done`.
- **Orders:** `status` is `requested`, `ordered`, `received` or `cancelled`.
- **Log:** append-only history of who changed what.

## Where the starting data came from

These sheets are in the lab Drive:

- Fall 2026 – CE 323 Inventory (updated 7/28/26). Counts and per-lab usage for Modules 1–3.
- Fall 2022 and Fall 2023 – CE 323 Inventory. Fisher catalog numbers and earlier orders.
- CE323 Resupply List and Alkalinity and Acidity Lab Supplies. Prices and Hach items.
- HACH Lab Equipment. Instruments and their condition.

The counts are as of July 2026. Several items were ordered after that, so **do a full count first**.

## Files

| Path | What it is |
| --- | --- |
| `index.html` | The page shell |
| `assets/app.js` | The website: pages, forms, calls to the backend |
| `assets/logic.js` | Counting, planning and ordering rules (also pasted into Apps Script as Logic.gs) |
| `assets/styles.css` | Styles, including dark mode and print |
| `assets/config.js` | The backend URL and time zone |
| `apps-script/` | Backend code to paste into Apps Script |
| `data/seed.json` | Starting supplies, labs, supply lists and equipment |
| `fonts/` | Atkinson Hyperlegible Next and its license |

## Publishing changes

Before each commit, run `sh scripts/stamp-version.sh` from the repo root. It puts a new version number on the CSS and JavaScript links, so browsers load the new files instead of cached ones.
