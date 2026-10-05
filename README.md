# Job Application Autofill

A Chrome extension (Manifest V3) that fills job application forms from a profile stored on your own machine, so you only have to review the form and click **Submit** yourself. It also logs each application to a Google Sheet and archives the job posting.

Works on Greenhouse (including embedded iframes), Lever, Ashby and Workday, plus a generic label-based fallback for other sites. LinkedIn is **log and save only**: it never autofills there.

## What it will never do

These are enforced in code and covered by tests, not just promises:

- **Never submits.** It does not click Submit, Apply, Next, Continue or Save and Continue, and never calls `form.submit()`. All clicking goes through one guarded module ([`src/fill/safety.ts`](src/fill/safety.ts)), and an ESLint rule bans `.click()`, `.submit()` and `.requestSubmit()` anywhere else in page-facing code. The end-to-end tests record every submit event and every click on a submit-like control and assert there are zero.
- **Never touches CAPTCHAs.** Anything inside reCAPTCHA, hCaptcha, Turnstile or similar widgets (including their hidden response fields) is skipped. Password fields are never filled.
- **Runs only when you ask.** There are no content scripts in the manifest. Nothing runs on page load; the script is injected only when you click the toolbar button or press the shortcut.
- **Keeps your data local.** Profile, resume and answers live in `chrome.storage.local` / IndexedDB. No analytics, no remote server. The only outbound calls are Google Sheets (when you log an application) and, only if you add an API key, Anthropic (see [Privacy](#privacy)).
- **Logs nothing automatically.** A row is written only after you confirm the log card.

## Install

Requirements: Node 20+ and npm.

```bash
npm install
npm run build
```

Then in Chrome open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose the `.output/chrome-mv3` folder.

> `npm run e2e` rebuilds `.output/` as a *test* build (extra `localhost` permissions and test hooks). Run `npm run build` again before loading the extension for real use.

The extension ID is pinned by the `key` in [`wxt.config.ts`](wxt.config.ts) to **`cihdjaikbfmejnlkcmncpggnjledlpoc`**, so the Google OAuth client keeps working across rebuilds and machines. (Details under [Google Cloud setup](#google-cloud-setup).)

Pin the toolbar icon, and check the shortcut at `chrome://extensions/shortcuts`. The default is **Alt+Shift+F** (fill the current page).

## First-time setup

Open the extension's options page (click the icon, then *Profile & settings*):

1. **Contact & work**: name, email, phone (and phone type, default *Mobile*), links, address, work preferences, start date, salary, notice period. EEO answers default to *Decline to self-identify*.
   - **Work authorization.** By default *Always answer "authorized to work" = Yes and "require sponsorship" = No* is **on**: every such question gets those answers whatever country it names, so check that it's true for the role before you click Fill. Turn it off to answer per country from your country list instead.
2. **Education & experience**: as many entries as you like. Dates as `YYYY-MM`.
3. **Resume**: upload your PDF (and optionally a cover letter). It is stored in this browser only.
4. **Answer bank** has two kinds of entry:
   - **With a question** ("Why this company?"), plus optional tags: reused directly when a form asks something similar.
   - **Without a question** (a *writing sample*): if you only have your old answers and not the questions, paste them into the box at the top of the tab (several at once, separated by a blank line or `---`; each answer needs at least 20 characters) and press the **Save** button at the bottom of the page. They are never typed into forms. With an API key, they tell the AI what you've built, what you care about and how you write, and it can draw on those facts when drafting answers to new questions.
5. **Settings**: Google Sheet ID and tab name, optional Anthropic API key and model name.
6. **Import / export**: back up everything to one JSON file (resume as base64). The API key is never exported. Keep backups out of git.

Click **Save** (bottom bar) after editing.

## Using it

1. Open an application form. Click the toolbar icon → **Fill this page** (or press Alt+Shift+F). Tick *Overwrite* only if you want already-filled fields replaced.
2. A review panel appears in the page (in a shadow root, so site CSS can't break it) and fields are outlined:
   - 🟢 **green**: filled from your profile with high confidence
   - 🟡 **yellow**: low-confidence match, a loose answer-bank match, or an **AI draft** that needs your review
   - 🔴 **red**: required and still empty
3. The panel lists fields that need attention; click one to scroll to it. Fix anything yellow or red.
4. **Save my answers to answer bank** captures the questions you answered by hand (and AI drafts you rewrote) for reuse. Untouched AI drafts are never saved as your answers.
5. Review the form and click **Submit yourself**.

**Workday** is a multi-step wizard. The extension fills the step you are on. Click **Save and Continue** yourself, then trigger the fill again for the next step.

**Repeated sections** (Work Experience 1, 2, 3 …; Education 1, 2 …), on every site: the n-th section on the page gets the n-th entry in your profile, counted in page order, so it doesn't matter how a site numbers its ids. Each gets its own title, company, location, description, and from/to month and year (a month dropdown is matched by name, "September", and a month text box gets "09"). A section beyond your entries is left empty and flagged; a job marked *current* gets its "I currently work here" box ticked and no end date.

**Dropdown wording.** Your profile text is expanded to the wording forms use, so "Bachelor" selects "Bachelor's degree", a degree like "BSc" does too, and a province code like "QC" selects "Quebec". When no option matches, the panel row lists what the dropdown actually offered, so you can see why and adjust your profile.

**Resume uploads** are checked after attaching. If the page doesn't show the file (some Workday upload zones ignore a programmatic file selection), the extension also drops the file onto the zone; if it still can't confirm, the row turns yellow instead of claiming success.

**Forms inside iframes** (a Greenhouse form embedded on a company site) work: the script is injected into every frame of the tab you triggered, and the panel appears in the top frame. Limitation: on an unknown site, cross-origin iframes from a domain the extension has no permission for can't be reached; the panel will simply list no fields from them.

### Log a posting without applying

You can log any job to your sheet whether or not you are applying. On a posting page (or any page), click the toolbar icon → **Log posting only (no autofill)**, or press **Alt+Shift+L**. The log card opens with company, category, location and URL filled in from the page, and **no form field is read or filled**. Logging never marks a job as applied: column C (Status) is always left empty, so use it however you like in the sheet. If you later log the same job, you get the duplicate warning with the row number, so you can update that row instead.

### Log application

The panel includes a **Log application** card, pre-filled and fully editable:

| Col | Field    | How it is filled |
|-----|----------|------------------|
| A | Company  | ATS URL slug / Workday tenant / page metadata |
| B | Category | `SWE` (default), `PM` (product manager), `FDE` (forward deployed) from the job title |
| C | Status   | always empty |
| D | Location | one of `montreal`, `vancouver`, `toronto`, `canada`, `USA`, `london` (case-sensitive). If no rule applies you must pick before logging |
| E | Date     | today (local) as `YYYY/MM/DD`, written with `USER_ENTERED` so Sheets parses it as a date |
| F | Channel  | `website`, or `linkedin` for a LinkedIn Easy Apply |
| G | Comments | always empty |
| H | URL      | canonical posting URL (not the `/apply` form), tracking params stripped |

- Allowed Category/Location values live in one file, [`src/config/tracking.ts`](src/config/tracking.ts), used for both validation and the dropdowns.
- Location rules, in order: a single listed city → that city; a single unlisted Canadian place or "Remote - Canada" → `canada`; a single US place or "Remote - US" → `USA`; several cities in one country → that country (`canada`/`USA`); several countries → `canada`. "London, ON" is Canada, "Vancouver, WA" is the US. Every rule is unit-tested.
- Before appending, column H is checked for the same posting (tracking params and `/apply` ignored) and you get a duplicate warning with **Log anyway**.
- A value starting with `=`, `+`, `-` or `@` (an odd company name) is written with a leading apostrophe so Sheets stores it as text, not a formula.
- Every confirmed row is also kept locally. If the write fails (offline, expired token) it is queued and retried on browser start and every 5 minutes; pending rows show in the popup and under **Options → Applications**, with Retry / Discard. If a retry finds the URL already in the sheet (e.g. a write that succeeded but whose response was lost) it asks instead of double-writing.
- The card has **Also save the posting** ticked by default. On a form-only page it is disabled with a hint.

### Save posting

**Save posting** (panel, popup, or via the log card) writes to Chrome's Downloads folder under:

```
Downloads/AutoFill/{Company}/{YYYY-MM-DD} {Title}/
    posting.mhtml   full-fidelity page snapshot (chrome.pageCapture)
    posting.md      clean description: title, company, location, salary if listed, full text
    answers.json    every question and the answer the form holds, with its source
                    (autofill / ai / existing / manual)
```

If you are on the application form and the description lives on a different page (Lever `/apply`, Ashby `/application`, Workday apply steps), it tells you to save from the posting page instead.

**About the folder.** `chrome.downloads` can only write inside Chrome's Downloads folder, so it cannot target `C:\path\to\AutoFill` directly. To have files land there, make `Downloads\AutoFill` a directory junction (one-time, in `cmd`):

```bat
mklink /J "%USERPROFILE%\Downloads\AutoFill" "C:\path\to\AutoFill"
```

If `Downloads\AutoFill` already exists as a normal folder, move or rename it first. Also make sure Chrome's *Ask where to save each file before downloading* setting is off, or each file prompts.

## Google Cloud setup

One time, about ten minutes. Uses Chrome's built-in Google sign-in (`chrome.identity`) with the scope `https://www.googleapis.com/auth/spreadsheets` only.

1. Go to <https://console.cloud.google.com/> and create a project (e.g. "Job autofill").
2. **APIs & Services → Library**: enable **Google Sheets API**.
3. **APIs & Services → OAuth consent screen**: choose *External*, fill in the app name and your email, add the scope `.../auth/spreadsheets`, and add your Google account under **Test users**.
   - While the app is in *Testing*, Google expires sign-ins after 7 days and you will be asked to sign in again. To avoid that for a personal tool, click **Publish app**. It stays unverified (you will see an "unverified app" warning once, which you can click through) and only you use it.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Chrome extension**
   - Item ID: **`cihdjaikbfmejnlkcmncpggnjledlpoc`**
   - Copy the generated client ID.
5. Create `.env.local` in the repo root (it is gitignored):
   ```
   WXT_OAUTH_CLIENT_ID=1234567890-abcdefg.apps.googleusercontent.com
   ```
   then `npm run build` and reload the extension at `chrome://extensions`.
6. **Your sheet**: create a Google Sheet (or use an existing one) with the headers `Company | Category | Status | Location | Date | Channel | Comments | URL` in columns A–H. Format column E as a date. Copy the **Sheet ID** from the URL (`.../spreadsheets/d/<ID>/edit`; pasting the whole URL also works) and note the tab name.
7. In the extension: **Options → Settings**, enter the Sheet ID and tab name, **Save**, then click **Test Google Sheets connection**. The first time, Chrome shows the Google consent window.

Notes:

- You must be signed in to Chrome with a Google account for `chrome.identity` to work. It is **not** available in Edge, Brave or other Chromium browsers (they would need a different OAuth flow, which this project does not implement).
- Rows are appended to `A:H` with `insertDataOption=INSERT_ROWS`. If rows ever land in the wrong place (Sheets guesses a "table" from the data and columns C/G are empty), tell me and I'll switch to writing to an explicit next-row range.
- If you rotate the pinned key (`npm run keygen -- --force`) the extension ID changes and you need a new OAuth client with the new ID. The private key is stored in `private/extension-key.pem` (gitignored).

## Privacy

| Data | Where it lives | Leaves your machine? |
|------|----------------|----------------------|
| Profile, resume, answer bank, logged rows, posting cache | `chrome.storage.local`, IndexedDB | No |
| Sheet ID, tab name | `chrome.storage.local` | No |
| Anthropic API key | `chrome.storage.local` | Only sent to Anthropic as your credential. Never exported |
| A logged row | local copy + your Google Sheet | Yes, to Google Sheets, only after you confirm |

**AI answers (optional).** Only when you have entered an API key, and only for an open-ended textarea with no close answer-bank match, the background worker calls Anthropic's API (official SDK) with: that question, the job posting text, your name, links, education, work history, up to three related saved answers, and your question-less writing samples (up to about 8,000 characters in total, newest first). It never sends your email, phone, address, salary or EEO answers. Anything you paste into the answer bank may be sent, so don't paste anything you wouldn't want Anthropic's API to see. The prompt asks for one concise answer of at most two paragraphs that blends the most relevant details from your past answers (it must not list or stack them), and forbids inventing experience; if your data can't support an answer the model replies with a marker and the field is left empty and flagged red. Without a key nothing is sent and the field is left empty. The model name is configurable in settings (default `claude-opus-5-5`).

Network destinations are limited by the manifest to the supported ATS sites, LinkedIn, `sheets.googleapis.com` and `api.anthropic.com`.

## What is and isn't verified

**Verified by automated tests** (396 unit tests; 39 end-to-end tests that load the built extension in a real browser against local fixtures): matching rules, the fill mechanics (including React-style controlled inputs, selects, radios, custom dropdowns, file inputs), the never-submit and never-CAPTCHA guards, the log/duplicate/escape/queue logic against a fake Sheets server, every location rule, posting extraction and the real MHTML/Markdown/JSON files, the answer bank and LLM flow with a stubbed model, the pinned extension ID, and a production-bundle check that no test hooks ship.

**Not verified against the real services**, and worth a first run with a throwaway sheet and a real application you are not going to submit:

- **Live ATS markup.** The Greenhouse, Lever, Ashby, Workday and LinkedIn adapters were written against fixtures modelled on those sites' public markup (ids, `data-automation-id`s, class patterns). Real pages change and have variants (for example the newer React Greenhouse boards, Ashby's real button groups, Workday's multi-select "How did you hear about us" widget, Lever's location suggestions, LinkedIn selectors). Expect to adjust hints in [`src/adapters/`](src/adapters) or add rows to [`src/config/matchRules.ts`](src/config/matchRules.ts), the one data file that drives label matching.
- **Google.** The OAuth flow and the Sheets append against Google's real servers (including that `2026/10/04` is parsed as a date in your sheet's locale). Use **Test Google Sheets connection** first, then log one row to a scratch tab.
- **The real Anthropic API.** Tested with a stubbed client and the SDK's real error classes, not with a live call.

Things deliberately left for you: free-text answers with no saved answer and no API key, "How did you hear about us", consent checkboxes, and any question the matcher can't recognise. They are listed in the panel.

## Extending it

- **A field isn't recognised**: add a row to [`src/config/matchRules.ts`](src/config/matchRules.ts) (an `attrs` regex for names/ids, a `label` regex, optional `synonyms` for the fuzzy stage). Rules are checked in order; attributes first, then labels, then fuzzy.
- **A platform needs special handling**: add hints in its adapter (`hintedKey` skips rule matching), or write a new adapter implementing `detect()`, `getFields()`, `fill()` ([`src/adapters/types.ts`](src/adapters/types.ts)) and register it in [`src/adapters/registry.ts`](src/adapters/registry.ts).
- **Add a fixture and a test** for it under `tests/fixtures/` and `tests/unit/` (and `tests/e2e/` if it needs a real browser).

## Development

```bash
npm run dev          # WXT dev build with reload
npm run build        # production build -> .output/chrome-mv3
npm run typecheck && npm run lint
npm test             # unit tests (Vitest + jsdom)
npm run e2e          # builds a test build, runs Playwright against fixtures
npm run keygen       # (re)generate the pinned extension key
```

- **E2E browser.** On Windows the e2e tests use the installed **Microsoft Edge** by default; elsewhere Playwright's Chromium (`npx playwright install chromium`). Override with `E2E_CHANNEL=chromium|msedge`. Branded Google Chrome 137+ ignores `--load-extension`, so it can't be used for these tests (it works fine for *Load unpacked* by hand).
- **Node and WXT.** WXT is pinned to 0.19 because newer releases need Node 20.18+. If you upgrade Node you can upgrade WXT.
- **Layout:** `src/adapters` (per-ATS), `src/detect` (descriptors, matching, values), `src/fill` (filling mechanics and the safety guard), `src/review` (panel, highlights), `src/posting` (extraction, saving), `src/tracking` (Sheets, queue, rules), `src/llm` (answer bank, prompt, client), `src/profile` (schema, storage, backup), `src/entrypoints` (background, content script, popup, options, offscreen).
- **Personal data never gets committed**: `private/` is gitignored; [`private.example/`](private.example) holds a fake profile you can copy. Test fixtures are synthetic.

## Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| "Google OAuth client ID is not set in this build" | Do step 5 of Google Cloud setup, then rebuild and reload |
| Sign-in window never appears / "OAuth2 not granted" | Not signed in to Chrome, wrong Item ID on the OAuth client, or you are not a listed test user |
| "No access to this sheet" / "Sheet not found" | Wrong Sheet ID, or the Google account you signed in with can't edit it |
| Rows pending in the popup | Offline or signed out; **Retry now** signs in if needed |
| Nothing happens on Alt+Shift+F | Another extension owns the shortcut; change it at `chrome://extensions/shortcuts` |
| A field is skipped | Check the panel's "Not filled" list; add a match rule, or the field is a CAPTCHA/password/consent control, which are skipped on purpose |
| Posting files appear in the wrong place | Downloads folder / junction, see [Save posting](#save-posting) |
