# JG Project Hub PWA — Installation Guide

## Files to upload to `jgimprovements-arch/jg-dispatch/`

1. **`project.html`** — the PWA shell
2. **`manifest.json`** — PWA manifest
3. **`service-worker.js`** — offline cache + install handler
4. **`icon-192.png`** — 192×192 app icon (use your JG logo)
5. **`icon-512.png`** — 512×512 app icon (use your JG logo)
6. **`icon-maskable-512.png`** — 512×512 maskable icon (logo centered with 20% safe-zone padding around edges)

## Icon generation (fastest path)

Use https://favicon.io/favicon-converter/ or https://realfavicongenerator.net/

Upload your `logo.png` from the repo. Download the generated bundle. You'll get the 3 PNG files above. Drop them in `jg-dispatch/`.

**For the maskable icon**: needs ~20% padding so the system can crop it into a circle/squircle without cutting off your logo. The favicon generator handles this automatically.

## Optional — add a link from hub.html

Add a tile/link to `project.html` so PMs and field staff can find it. Example:

```html
<a href="project.html" class="hub-tile">
  <span class="ico">📱</span>
  <span class="label">Project Hub (Mobile)</span>
</a>
```

## How users install it

**iPhone (Safari):**
1. Open `https://jgimprovements-arch.github.io/jg-dispatch/project.html`
2. Tap the share button (square with arrow up)
3. Scroll → "Add to Home Screen"
4. Tap "Add"

**Android (Chrome):**
1. Open the same URL
2. Chrome shows an install banner — tap "Install"
3. OR menu (⋮) → "Install app"

**Desktop (Chrome/Edge):**
1. Visit the URL
2. Address bar shows an install icon (⊕ or 📱)
3. Click → Install

## What happens after install

- App icon on home screen launches standalone (no browser chrome)
- Service worker caches the app shell so it boots in <1s after first launch
- Reads user's email from `localStorage.jg_platform_user` (same key as the rest of the platform — user must have signed in once via a browser)
- **Auto-routes by role**:
  - **Field tech**: today's job(s), big green Clock In button
  - **PM / Admin**: project list with search, KPIs, links into rebuild.html
- Works offline — shows last-cached project list with an amber "You're offline" banner

## Notes

- Field tech detection uses the `employees` table: matches `email` or `personal_email` lowercased
- Today's jobs found via `rebuild_phase_assignees` where `employee_id` matches AND today's date falls within `scheduled_start` → `scheduled_end`
- Service worker scope is `/jg-dispatch/` — works for all pages under that path
- Cache version is `jg-project-v1` — bump this in `service-worker.js` when you ship updates and want to force cache refresh
