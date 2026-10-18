# Money, sorted

**A simple installable web app that puts your outgoings, benefit payment dates and card balance in one place.**

**Live demo:** [money-sorted.wearesparklab.com](https://money-sorted.wearesparklab.com/)

Built to answer "what's due and what's left?" at a glance, without a spreadsheet. It's one of the SparkLab apps.

## Features

- **Outgoings:** add recurring payments and see what's due this month. Past months are one tap away.
- **Payment dates:** keep benefit payment schedules alongside your bills.
- **Card tracker:** add cards and the items on them to see the running balance.
- **Accounts:** sign up and log in, and your data is stored per user in Supabase and syncs across devices.
- **Installable (PWA):** add it to your home screen, with a service worker for fast loading and a light/dark mode toggle.

## Tech stack

- Single-page app in plain HTML, CSS and JavaScript (`index.html`, no build step)
- Supabase: Postgres, Auth (email and password) and Row Level Security
- `@supabase/supabase-js` loaded from a CDN
- Web app manifest and service worker (`manifest.json`, `sw.js`)
- Static site, no server code

## Run it locally

```bash
git clone https://github.com/WeAreSparkLab/Money-sorted.git
cd Money-sorted
npx serve .        # or open index.html in a browser
```

To use your own backend, create a Supabase project and replace the URL and anon key constants near the top of `index.html` with values from **Project Settings -> API**. Create these tables, each with a `user_id` column and RLS policies so users can only read and write their own rows: `outgoings`, `benefit_schedules`, `credit_cards`, `card_items`, `settings`.

## Security model

The Supabase anon key in `index.html` is designed to be public. Your data is protected by Row Level Security and by signing in, not by hiding the key. Never commit a `service_role` key.

## What I'd improve next

- Add a SQL migration file so the schema can be created with one command.
- Add monthly summaries, charts and reminders for upcoming payments.
- Add export to CSV.
- Add tests for the date and balance calculations.
