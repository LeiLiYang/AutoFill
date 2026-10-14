# Job Application Autofill

A Chrome extension (Manifest V3) that fills job application forms from a profile stored on your own machine, so you only have to review the form and click **Submit** yourself. It also logs each application to a Google Sheet and archives the job posting.

Works on Greenhouse (including embedded iframes), Lever, Ashby and Workday, plus a generic label-based fallback for other sites. 

## What it will never do

These are enforced in code and covered by tests, not just promises:

- **Never submits.** It does not click Submit, Apply, Next, Continue or Save and Continue, and never calls `form.submit()`. All clicking goes through one guarded module ([`src/fill/safety.ts`](src/fill/safety.ts)), and an ESLint rule bans `.click()`, `.submit()` and `.requestSubmit()` anywhere else in page-facing code. The end-to-end tests record every submit event and every click on a submit-like control and assert there are zero.
- **Never touches CAPTCHAs.** Anything inside reCAPTCHA, hCaptcha, Turnstile or similar widgets (including their hidden response fields) is skipped. Password fields are never filled.
- **Runs only when you ask.** There are no content scripts in the manifest. Nothing runs on page load; the script is injected only when you click the toolbar button or press the shortcut.
- **Keeps your data local.** Profile, resume and answers live in `chrome.storage.local` / IndexedDB. No analytics, no remote server. The only outbound calls are Google Sheets (when you log an application) and, only if you set up an AI provider, that provider (Anthropic, OpenAI, Google Gemini, or any OpenAI-compatible server you point it at; see [Privacy](#privacy)).
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
5. **Settings**: Google Sheet ID and tab name, and an optional AI provider: Anthropic, OpenAI, Google Gemini, or an OpenAI-compatible server (OpenRouter, Groq, a local Ollama). Enter the key and model, then **Test connection and list models** to check the key and pick a model from the provider's own list (no prompt is sent, so it costs nothing).
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

**Forms inside iframes** (a Greenhouse form embedded on a company site) work: the script is injected into every frame of the tab you triggered, and the panel appears in the top frame. This includes forms a company embeds from another domain (iCIMS, SmartRecruiters and other ATS iframes): the extension has host access to all sites for that reason. Fields inside open shadow roots (web-component forms), radios and checkboxes hidden behind styled labels, and custom ARIA radios, checkboxes and dropdowns are found too. If a frame cannot be reached, or the page has no form yet, the panel says so.

### Log a posting without applying

You can log any job to your sheet whether or not you are applying. On a posting page (or any page), click the toolbar icon → **Log posting only (no autofill)**, press **Alt+Shift+L**, or right-click anywhere on the page → **Log this posting**. (Chrome decides where extension items sit in the right-click menu, so it appears in the extensions group rather than at the very top.) The log card opens with company, category, location and URL filled in from the page, and **no form field is read or filled**. Logging never marks a job as applied: column C (Status) is always left empty, so use it however you like in the sheet. If you later log the same job, you get the duplicate warning with the row number, so you can update that row instead.

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
- Where the location is read from: the platform's own markup, schema.org `JobPosting` data (including remote postings), a "Location" caption with its value in a list, table or line of text (also "Lieu de travail"), elements whose class or test id says location, the line under the title, the page title, and Workday's address. Every reading is tried and the first one that names a place the rules above can classify wins, so a stray match no longer hides the right one. Places written without commas ("Montreal QC", "Toronto and Vancouver") are understood. An application form rarely repeats the location, so the card takes it from the posting page if you opened the panel there first.
- Before appending, column H is checked for the same posting (tracking params and `/apply` ignored) and you get a duplicate warning with **Log anyway**.
- A value starting with `=`, `+`, `-` or `@` (an odd company name) is written with a leading apostrophe so Sheets stores it as text, not a formula.
- Every confirmed row is also kept locally. If the write fails (offline, expired token) it is queued and retried on browser start and every 5 minutes; pending rows show in the popup and under **Options → Applications**, with Retry / Discard. If a retry finds the URL already in the sheet (e.g. a write that succeeded but whose response was lost) it asks instead of double-writing.
- The card has **Also save the posting** ticked by default. The row is written first and the posting is saved afterwards, so a slow or failed save never hides whether the log went through. Any failure is shown in the card.

### Save posting

**Save posting** (panel, popup, or via the log card) writes to Chrome's Downloads folder under:

```
Downloads/AutoFill/{Company}/{YYYY-MM-DD} {Title}/
    posting.mhtml   full-fidelity page snapshot (chrome.pageCapture)
    posting.md      clean description: title, company, location, salary if listed, full text
    answers.json    every question and the answer the form holds, with its source
                    (autofill / ai / existing / manual)
```

**Answers.** `answers.json` is read from the form at the moment you save, from every frame, whether or not you pressed Fill. Each fill also records what that step of the form held, and a later save adds to it, so a multi-step application ends up with the answers from all its steps.

**Saving from the application form** (Lever `/apply`, Ashby `/application`, Workday apply steps, in-house forms) works: the answers are always saved. The description comes from the posting page if you opened the panel there before moving on to the form in the same tab (or the tab it opened); otherwise `posting.md` says it has none and a note tells you to save again from the posting page. `posting.mhtml` is then a snapshot of the form.

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
| AI provider API keys | `chrome.storage.local` | Each is only sent to its own provider as your credential. Never exported |
| A logged row | local copy + your Google Sheet | Yes, to Google Sheets, only after you confirm |

**AI answers (optional).** Only when a provider is set up, and only for an open-ended question with no close answer-bank match, the background worker calls the provider you chose (Anthropic through its official SDK; OpenAI, Gemini and OpenAI-compatible servers over HTTPS) with: that question, the job posting text (benefits, pay and EEO sections removed), your name, links, education, work history, your optional "how you write" notes, up to three related saved answers, and the three question-less writing samples closest to the question. It never sends your email, phone, address, salary or EEO answers. Anything you paste into the answer bank may be sent, so don't paste anything you wouldn't want that provider to see. The prompt sizes the answer to the question (a sentence for a factual question, one paragraph for most, two only when the form asks for an essay or cover letter), asks for plain prose in your own voice, and forbids inventing experience; if your data can't support an answer the model replies with a marker and the field is left empty and flagged red. Without a provider nothing is sent and the field is left empty.

**Recognising fields (optional, on by default once a provider is set up).** Fields that none of the built-in rules recognise (unusual wording, other languages, in-house forms) are sent to the provider's small "recognising fields" model in one request per page: only each field's label, its kind and its options, never anything from your profile. The model answers which profile field each one asks for, or "none". The answer is remembered per site, so a site costs one small request the first time and nothing afterwards. Fields filled this way are always yellow ("matched by AI: check it"). Turn it off in Settings.

**Keeping API usage down.** The instructions and the posting + profile are sent as a cacheable prefix, so every question after the first on a page reads them at a fraction of the price (explicit cache breakpoints on Anthropic; OpenAI and Gemini cache a repeated prefix on their own). A draft is stored per posting and question for 30 days, so filling the same application again, or its next step, costs nothing; turn on "Overwrite already-filled fields" to get a fresh draft. The default Anthropic model is `claude-opus-5-5`; `claude-sonnet-5-5` is a cheaper choice for these short answers.

The manifest grants host access to all sites (`<all_urls>`). That is what lets the filler reach an application form embedded from another domain; it does not change when the extension runs. There are still no declared content scripts: nothing is injected into any page until you press Fill, Log or Save. The only network calls the extension itself makes are to `sheets.googleapis.com` and, with an API key, `api.anthropic.com`.

## What is and isn't verified

**Verified by automated tests** (575 unit tests; 48 end-to-end tests that load the built extension in a real browser against local fixtures): matching rules, the fill mechanics (including React-style controlled inputs, selects, radios, custom dropdowns, file inputs), the never-submit and never-CAPTCHA guards, the log/duplicate/escape/queue logic against a fake Sheets server, every location rule, posting extraction and the real MHTML/Markdown/JSON files, the answer bank and LLM flow with a stubbed model, the pinned extension ID, and a production-bundle check that no test hooks ship.

**Not verified against the real services**, and worth a first run with a throwaway sheet and a real application you are not going to submit:

- **Live ATS markup.** The Greenhouse, Lever, Ashby, Workday and LinkedIn adapters were written against fixtures modelled on those sites' public markup (ids, `data-automation-id`s, class patterns). Real pages change and have variants (for example the newer React Greenhouse boards, Ashby's real button groups, Workday's multi-select "How did you hear about us" widget, Lever's location suggestions, LinkedIn selectors). Expect to adjust hints in [`src/adapters/`](src/adapters) or add rows to [`src/config/matchRules.ts`](src/config/matchRules.ts), the one data file that drives label matching.
- **Google.** The OAuth flow and the Sheets append against Google's real servers (including that `2026/10/04` is parsed as a date in your sheet's locale). Use **Test Google Sheets connection** first, then log one row to a scratch tab.
- **The real provider APIs.** Anthropic is tested with a stubbed client and the SDK's real error classes; OpenAI, Gemini and OpenAI-compatible servers with a stubbed `fetch`. None with a live call.

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
| Fill finds no fields | The panel says "No form fields found": the form usually opens after you click Apply, or sits on a later step. Open it and press Fill again |
| A field is skipped | Check the panel's "Not filled" list; add a match rule, or the field is a CAPTCHA/password/consent control, which are skipped on purpose |
| Posting files appear in the wrong place | Downloads folder / junction, see [Save posting](#save-posting) |
