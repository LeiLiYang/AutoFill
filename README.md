# Job Application Autofill

**A Chrome extension that fills in job application forms for you, so applying is faster and every application is tracked.**

Applying to dozens of roles means typing the same details into dozens of different forms. This tool fills them from a profile stored on your own machine, drafts answers to free-text questions, and logs every application, so nothing gets lost.

## What it does

- **Fills application forms** on Greenhouse, Lever, Ashby and Workday, with a label-based fallback for company-specific sites.
- **Drafts free-text answers grounded in you.** It reuses your past answers and draws on the facts you've given it about your experience, projects and interests. Every draft is flagged for your review.
- **Flags what needs a human**: fields are marked green (confident), yellow (review this) or red (still missing), so you check only what matters.
- **Tracks applications** by logging each one to a Google Sheet, and saves a snapshot of the job posting along with the answers you gave.

## Design principles

- **You stay in control.** It fills the form and you review and submit it yourself. Submitting is never automated, and that's enforced in code and tests.
- **Local-first.** Your profile, resume and answers stay in your browser. There is no backend and no analytics. The only outbound calls are Google Sheets and the AI provider you choose to enable.
- **Runs only when asked.** Nothing runs on page load.

## Tech

TypeScript, React, Manifest V3, [WXT](https://wxt.dev), Vitest, Playwright, Google Sheets API, multi-provider LLM client (Anthropic / OpenAI / Gemini / OpenAI-compatible).

## Run it

```bash
npm install
npm run build   # then load .output/chrome-mv3 via chrome://extensions
```

Full setup, including Google Cloud and profile configuration, is in [docs/SETUP.md](docs/SETUP.md).
