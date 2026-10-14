# Money, sorted

A single-page money planning app.

## Setup

This is a static page: no build step and no `.env` file.

1. Open `index.html` in a browser, or serve the folder from any static host.
2. `index.html` ships the Supabase project URL and the **anon/public** key. That key is designed to be visible in the browser; your data is protected by Row Level Security (RLS) policies, not by hiding the key.
3. To run against your own Supabase project, replace the URL and anon key constants in `index.html` with your own (Supabase dashboard -> Project Settings -> API). Never commit a `service_role` key.
