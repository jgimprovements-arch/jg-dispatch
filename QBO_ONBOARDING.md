# QBO OAuth Onboarding — One-Time Setup

This is the hardest part of the whole build. You only do it once, but you have to do every step. Budget 30 minutes.

## What you need before you start

- Access to your QuickBooks Online Admin login
- Access to the Supabase dashboard for project `nuykvchgecpiuikoerze`
- Access to the Vercel dashboard for `jg-proxy-v2`
- A text editor to paste tokens into (do NOT use email or Slack — these are credentials)

---

## Step 1 — Register an Intuit developer app

1. Go to https://developer.intuit.com/app/developer/dashboard
2. Sign in with the same Intuit ID that owns your QBO company
3. Click **Create an app** → **QuickBooks Online and Payments**
4. Name it: `JG Restoration Enrichment`
5. Scope: check **com.intuit.quickbooks.accounting** (only this one)
6. You'll land on the app's dashboard

## Step 2 — Get production keys

1. In the app dashboard, left sidebar → **Production Settings** → **Keys & OAuth**
2. You'll see two values — copy them somewhere safe:
   - **Client ID** (looks like `ABx1234...`)
   - **Client Secret** (looks like `a1b2c3...`)
3. Under **Redirect URIs**, click **Add URI** and paste:
   ```
   https://developer.intuit.com/v2/OAuth2Playground/RedirectUrl
   ```
   Save.

> **Note:** we're using Intuit's OAuth Playground as the redirect because we're not building a user-facing auth flow — this is a one-time admin bootstrap. The Playground is Intuit's official tool for exactly this purpose.

## Step 3 — Run the OAuth Playground to get your first refresh token

1. Go to https://developer.intuit.com/app/developer/playground
2. **App** dropdown → select `JG Restoration Enrichment`
3. **Environment** → **Production**
4. **Scopes** → check **com.intuit.quickbooks.accounting**
5. Click **Get authorization code**
6. You'll be redirected to Intuit login → sign in with your QBO admin account → **Connect** to the company → you'll be redirected back to the Playground
7. You should now see an **Authorization Code** and **Realm ID** filled in
   - **Copy the Realm ID** — this is your QBO Company ID
8. Click **Get tokens from auth code**
9. You'll see:
   - **Access Token** (expires in 1 hour — don't worry about it)
   - **Refresh Token** ← **COPY THIS**, this is the critical one

You now have three values:
- Client ID
- Client Secret
- Realm ID
- Refresh Token

## Step 4 — Store the refresh token in Supabase

1. Open Supabase SQL Editor for project `nuykvchgecpiuikoerze`
2. Run:

```sql
UPDATE public.platform_settings
   SET value = 'PASTE_YOUR_REFRESH_TOKEN_HERE',
       updated_at = NOW()
 WHERE key = 'qbo_refresh_token';
```

3. Verify:

```sql
SELECT key, LEFT(value, 10) || '...' AS preview, updated_at
  FROM public.platform_settings
 WHERE key = 'qbo_refresh_token';
```

The preview should show the first 10 characters of your token, not `SET_VIA_ONBOARDING`.

## Step 5 — Set Vercel environment variables

1. Go to Vercel dashboard → `jg-proxy-v2` → **Settings** → **Environment Variables**
2. Add these (all scoped to **Production**):

| Name | Value |
|---|---|
| `QBO_CLIENT_ID` | your Client ID from Step 2 |
| `QBO_CLIENT_SECRET` | your Client Secret from Step 2 |
| `QBO_REALM_ID` | your Realm ID from Step 3 |
| `QBO_ENVIRONMENT` | `production` |
| `SUPABASE_URL` | `https://nuykvchgecpiuikoerze.supabase.co` |
| `SUPABASE_SERVICE_KEY` | **service_role** key from Supabase Settings → API (NOT the anon key) |
| `CRON_SECRET` | any random string — generate with `openssl rand -hex 32` in a terminal, or paste a 40+ char random string |

3. Click **Save** after each one

## Step 6 — Deploy the function

1. Add `api/enrich-rebuttals.js` and `vercel.json` to your `jg-proxy-v2` repo
2. Commit + push to main
3. Vercel auto-deploys
4. Verify cron registered: Vercel dashboard → `jg-proxy-v2` → **Cron Jobs** tab should show `/api/enrich-rebuttals` scheduled at `0 8 * * *`

## Step 7 — Manual first run (recommended)

Don't wait until 3 AM to find out if it works. Trigger it manually:

```bash
curl -X GET https://jg-proxy-v2.vercel.app/api/enrich-rebuttals \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

You should see a JSON response like:
```json
{ "ok": true, "enriched": 0, "no_match": 2, "pending": 2 }
```

`no_match: 2` is expected on first run — your 2 backfilled rebuttals (Albrecht, Freude) probably don't have QBO invoices yet with those project names in the memo, OR they've been paid and you haven't set a link.

## Step 8 — Verify in Supabase

```sql
SELECT status, started_at, finished_at, jsonb_array_length(steps) AS step_count, jsonb_array_length(errors) AS error_count
  FROM public.enrichment_runs
 ORDER BY finished_at DESC
 LIMIT 5;
```

You should see your manual run with `status = 'success'`.

---

## Ongoing maintenance

**The token auto-rotates as long as the function runs at least every 100 days.** Since it runs nightly, you should never have to think about it. BUT:

- If you pause the cron for >100 days (vacation, Vercel issue), the token expires and the function will fail with `qbo_refresh_failed`. Fix: repeat Step 3 + Step 4 to get a fresh token.
- If someone deletes the Intuit app, disconnects QBO, or changes QBO admin — same thing: repeat Step 3 + Step 4.
- Set a calendar reminder to check `enrichment_runs` once a month for `status = 'failed'`. Takes 30 seconds.

## Pre-sale note

When you sell the business, the buyer will need to:
1. Register their own Intuit developer app
2. Re-authorize via OAuth with their QBO credentials
3. Replace `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REALM_ID`, and `qbo_refresh_token` with theirs

This should be part of the closing checklist the attorney builds. The infrastructure transfers cleanly; only the auth re-ups.
