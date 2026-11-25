# Catherine Anne Fishing Log (Billfish Log)

**Live:** https://clappin27.github.io/CatherineAnneFishingLog/

**Pilot:** right now the app serves one boat, the Catherine Anne. People join with the boat code (or the invite link from the Boat tab, which fills the code in). To open it to other boats later, set `PILOT_BOAT_ONLY = false` in `app/config.js` and run `grant execute on function public.create_boat(text, text) to authenticated;` in Supabase.

A phone-first catch log for billfish crews. Captains create a boat, share an invite code, and the whole crew logs every bite (species, result, angler, spread position, lure, tide, conditions, GPS) into one shared log. Each boat's log is private to that boat. It installs to the home screen on iPhone, iPad, Android and computers, and keeps working offshore with no signal: bites save on the phone and upload when it reconnects.

## What's in this folder

| Path | What it is |
|---|---|
| `app/` | The whole app: plain HTML/CSS/JS, no build step. Host this folder as-is. |
| `app/config.js` | Supabase project URL and public (anon) key. |
| `app/sw.js` | Service worker: keeps the app usable offline. Bump `VERSION` on every release. |
| `app/vendor/supabase.js` | Supabase JS client v2.45.4 (pinned copy, so the app loads offline). |
| `supabase/migrations/` | Database tables, security rules (row level security) and server functions. |
| `tools/make_icons.py` | Redraws the app icons (`python3 tools/make_icons.py`). |
| `prototype/` | The original single-boat prototype (kept on this computer only, not in the public repo). |

## Backend

Supabase project **Billfish Log** (`ooxoyiyvvnebiopogiob`, us-east-1).

- `profiles`, `boats`, `boat_members` (captain / crew), `catches`.
- Every table has row level security: people only ever see boats they belong to and those boats' catches.
- Joining, creating boats, invite codes and crew roles go through server functions (`create_boat`, `join_boat`, `regenerate_invite`, `set_member_role`, `remove_member`).
- Catches are soft-deleted (`deleted_at`) so phones that were offline learn about deletions.

## Before real users sign up (one-time setup in the Supabase dashboard)

1. **Email sign-up:** done. "Confirm email" is off, so people sign up and get straight in.
2. **Site URL:** done. It's set to the live address, which is also in Redirect URLs.
3. **Password resets** still need a real email sender (Supabase's built-in one only reaches the project owner). Add one under **Authentication → Emails → SMTP Settings** (for example Resend). Do this before other boats join.
4. **Test login** `test@test.com` (simple password, for the pilot only) is a captain of the Catherine Anne. Delete it under **Authentication → Users**, or change its password, before the pilot ends.

## Hosting

`app/` is a static site. Any static host works, as long as it serves HTTPS (needed for install, offline mode and GPS):

- **GitHub Pages:** push this repo, then Settings → Pages → deploy from the `app` folder (or move `app/` to `docs/`).
- **Netlify / Cloudflare Pages / Vercel:** point the site at the `app` folder; no build command.
- A custom domain (about $15/year) makes the invite links look trustworthy.

The app works from a sub-path (e.g. `https://you.github.io/billfish-log/`): every path is relative and invite links use the page's own address.

## Releasing an update

1. Change files in `app/`.
2. Bump `VERSION` in `app/sw.js` (required: phones only pick up a release when this file changes).
3. Commit and push to `main`; GitHub Actions publishes `app/` to Pages. Phones pick up the new version the next time the app is opened with signal.

## Local testing

```
python3 -m http.server 8766 --directory app
```

Then open http://localhost:8766. (Service workers and GPS only run on `localhost` or HTTPS.)
