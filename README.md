# 🍪 Manheim Cookie Refresher v2.0

**Automated daily cookie extraction with 2FA support** for Manheim MMR access. This scraper uses a persistent browser profile to build trust with MMR, handles credential login fallback, and automates 2FA verification.

---

## ✨ New Features (v2.0)

🎉 **Persistent Browser Profile** - Uses the same browser between runs to build trust with MMR
🔐 **Credential Login Fallback** - Automatically logs in if cookies are invalid
🛡️ **2FA Automation** - Integrates with n8n webhook to retrieve and enter 2FA codes
📦 **Longer Cookie Lifespan** - After ~3 2FA logins, MMR trusts the browser and cookies last longer

---

## 🎯 What It Does

1. **Launches persistent browser** from `./manheim_browser_profile` folder
2. **Injects yesterday's cookies** (if provided)
3. **Navigates to site.manheim.com**
4. **Detects login page** (if cookies invalid):
   - Enters credentials (username + password)
   - Checks "Remember my username"
   - Submits login form
5. **Handles 2FA** (if prompted):
   - Calls webhook: `https://n8nsaved-production.up.railway.app/webhook/mmr2facode`
   - Waits for response with 2FA code
   - Enters code automatically
   - Submits 2FA form
6. **Opens MMR tool** via button click or direct navigation
7. **Clicks VIN input field** to trigger JS events
8. **Uses browser back button** to return
9. **Checks if cookies changed** vs input cookies
10. **Performs up to 3 hard refreshes** if needed
11. **Simulates human activity** (mouse, scrolling, delays)
12. **Extracts 4 fresh cookies**:
   - `_cl` from `.manheim.com`
   - `SESSION` from `.manheim.com`
   - `session` from `mcom-header-footer.manheim.com`
   - `session.sig` from `mcom-header-footer.manheim.com`
13. **Sends cookies to webhook**: `https://n8nsaved-production.up.railway.app/webhook/mmrcookies`
14. **Saves backup** to Apify key-value store
15. **Closes browser** - profile saved to disk for next run

---

## 🔧 Setup Instructions

### 1. Extract Initial Cookies (First Time Only)

You need to manually extract cookies **once** to bootstrap the system.

**Option A: Using Browser Extension (Easiest)**
1. Install "EditThisCookie" extension (Chrome/Edge) or "Cookie-Editor" (Firefox)
2. Login to https://home.manheim.com/
3. Click the extension icon
4. Click "Export" → Copy JSON
5. Format it properly (see example below)

**Option B: Using Browser DevTools**
1. Login to https://home.manheim.com/
2. Press F12 to open DevTools
3. Go to **Application** tab → **Cookies**
4. Find and copy these 4 cookies:
   - `_cl` from `.manheim.com`
   - `SESSION` from `.manheim.com`
   - `session` from `mcom-header-footer.manheim.com`
   - `session.sig` from `mcom-header-footer.manheim.com`

**Cookie Format:**
```json
[
  {
    "name": "_cl",
    "value": "abcd1234...",
    "domain": ".manheim.com",
    "path": "/",
    "httpOnly": false,
    "secure": false,
    "sameSite": "Lax"
  },
  {
    "name": "SESSION",
    "value": "xyz789...",
    "domain": ".manheim.com",
    "path": "/",
    "httpOnly": true,
    "secure": false,
    "sameSite": "Lax"
  },
  {
    "name": "session",
    "value": "eyJhc3...",
    "domain": "mcom-header-footer.manheim.com",
    "path": "/",
    "httpOnly": true,
    "secure": true,
    "sameSite": "None"
  },
  {
    "name": "session.sig",
    "value": "BPzqO3V...",
    "domain": "mcom-header-footer.manheim.com",
    "path": "/",
    "httpOnly": true,
    "secure": true,
    "sameSite": "None"
  }
]
```

---

### 2. Deploy to Apify

**Option A: Via Apify CLI**
```bash
cd "MMR Cookies"
apify login
apify push
```

**Option B: Via Apify Console**
1. Create new Actor
2. Upload code as ZIP
3. Build & Publish

---

### 3. Configure n8n Webhook (Optional)

If you want n8n to automatically update the Apify input with fresh cookies:

1. Create a webhook node in n8n: `https://n8n-production-0d7d.up.railway.app/webhook/mmrcookies`
2. Extract `cookies` array from webhook payload
3. Use Apify API to update the Cookie Refresher input with fresh cookies
4. Use Apify API to update the MMR Scraper input with fresh cookies

This creates a fully automated loop!

---

## 📝 Input Configuration

### Full Configuration (v2.0)

```json
{
  "manheimCookies": [
    {
      "name": "_cl",
      "value": "YOUR_CL_COOKIE_VALUE",
      "domain": ".manheim.com",
      "path": "/",
      "httpOnly": false,
      "secure": false,
      "sameSite": "Lax"
    },
    {
      "name": "SESSION",
      "value": "YOUR_SESSION_COOKIE_VALUE",
      "domain": ".manheim.com",
      "path": "/",
      "httpOnly": true,
      "secure": false,
      "sameSite": "Lax"
    },
    {
      "name": "session",
      "value": "YOUR_SESSION_COOKIE_VALUE",
      "domain": "mcom-header-footer.manheim.com",
      "path": "/",
      "httpOnly": true,
      "secure": true,
      "sameSite": "None"
    },
    {
      "name": "session.sig",
      "value": "YOUR_SESSION_SIG_VALUE",
      "domain": "mcom-header-footer.manheim.com",
      "path": "/",
      "httpOnly": true,
      "secure": true,
      "sameSite": "None"
    }
  ],
  "credentials": {
    "username": "your@email.com",
    "password": "yourpassword"
  },
  "twoFactorWebhookUrl": "https://n8nsaved-production.up.railway.app/webhook/mmr2facode",
  "cookieWebhookUrl": "https://n8nsaved-production.up.railway.app/webhook/mmrcookies",
  "proxyConfiguration": {
    "useApifyProxy": false
  }
}
```

### Field Descriptions

- **manheimCookies** (optional if credentials provided): Yesterday's cookies
- **credentials** (required for login fallback):
  - `username`: Your Manheim account email
  - `password`: Your Manheim account password
- **twoFactorWebhookUrl**: Webhook that returns 2FA code when called
- **cookieWebhookUrl**: Webhook to receive fresh cookies
- **proxyConfiguration**: Proxy settings (optional)

---

## 🔐 2FA Webhook Integration

The scraper calls your 2FA webhook when it detects a 2FA page. Your webhook should:

1. **Receive the request** (POST with username in body)
2. **Retrieve the 2FA code** (from email, SMS, authenticator app, etc.)
3. **Return the code** in one of these formats:

**JSON Response (Preferred):**
```json
{
  "code": "123456"
}
```

**Alternative JSON keys (also supported):**
```json
{ "2fa_code": "123456" }
{ "otp": "123456" }
{ "token": "123456" }
```

**Plain Text Response:**
```
123456
```

### Example n8n 2FA Workflow

```
1. Webhook Trigger (receive request from scraper)
   ↓
2. Email Node (fetch latest Manheim email)
   ↓
3. Extract 2FA code from email body (regex: \d{6})
   ↓
4. Return JSON: { "code": "123456" }
```

---

## 🌐 Persistent Browser Profile

### Why It Matters

MMR only trusts browsers it recognizes. After ~3 successful 2FA logins with the same browser profile, MMR starts to:
- ✅ Trust the browser
- ✅ Keep cookies valid longer
- ✅ Stop asking for 2FA as frequently
- ✅ Allow hard refresh to generate new cookies

### How It Works

**First Run (one-time setup):**
- Browser opens from `./manheim_browser_profile` folder
- Logs in with credentials + 2FA
- Browser closes, everything saved to folder

**Every Day After:**
- Scraper opens `./manheim_browser_profile`
- Cookies/storage already there
- Visits Manheim → refreshes → ✅ new cookies
- Browser closes, saves everything back

**The Folder Contains:**
- All cookies
- localStorage
- sessionStorage
- IndexedDB
- Everything Manheim checks to verify "same computer"

---

## 🔒 Anti-Ban Features

✅ **Persistent browser profile** - Same browser fingerprint every run (builds trust)
✅ **Cookie injection** - Reuses valid cookies when possible
✅ **Credential fallback** - Only logs in when cookies expire
✅ **2FA automation** - Handles verification without manual intervention
✅ **Human-like mouse movements** - Random positions and paths
✅ **Random scrolling** - Natural page interaction
✅ **Variable delays** - 1-6 seconds between actions
✅ **Stealth plugins** - Hides automation markers
✅ **CAPTCHA detection** - Stops if challenged
✅ **Smart detection** - Identifies login/2FA pages automatically

---

## 📤 Webhook Payload

Fresh cookies sent to your n8n webhook:

```json
{
  "success": true,
  "timestamp": "2025-01-28T10:30:00.000Z",
  "cookies": [
    {
      "name": "_cl",
      "value": "fresh_value_here",
      "domain": ".manheim.com",
      "path": "/",
      "httpOnly": false,
      "secure": false,
      "sameSite": "Lax",
      "expires": 1234567890
    },
    {
      "name": "SESSION",
      "value": "fresh_value_here",
      "domain": ".manheim.com",
      "path": "/",
      "httpOnly": true,
      "secure": false,
      "sameSite": "Lax",
      "expires": 1234567890
    },
    {
      "name": "session",
      "value": "fresh_value_here",
      "domain": "mcom-header-footer.manheim.com",
      "path": "/",
      "httpOnly": true,
      "secure": true,
      "sameSite": "None",
      "expires": 1234567890
    },
    {
      "name": "session.sig",
      "value": "fresh_value_here",
      "domain": "mcom-header-footer.manheim.com",
      "path": "/",
      "httpOnly": true,
      "secure": true,
      "sameSite": "None",
      "expires": 1234567890
    }
  ],
  "cookieDetails": {
    "_cl": {
      "found": true,
      "domain": ".manheim.com",
      "expires": 1234567890
    },
    "SESSION": {
      "found": true,
      "domain": ".manheim.com",
      "expires": 1234567890
    },
    "session": {
      "found": true,
      "domain": "mcom-header-footer.manheim.com",
      "expires": 1234567890
    },
    "session.sig": {
      "found": true,
      "domain": "mcom-header-footer.manheim.com",
      "expires": 1234567890
    }
  }
}
```

**On Failure:**
```json
{
  "success": false,
  "timestamp": "2025-01-28T10:30:00.000Z",
  "error": "CAPTCHA challenge detected",
  "cookies": null
}
```

---

## 🔄 Daily Workflow

### Fully Automated Loop:

```
Day 1 (Manual):
  → Extract cookies manually
  → Configure Apify input

Day 2+:
  1. Cookie Refresher runs (scheduled 3 AM)
  2. Uses Day 1 cookies → Extracts fresh Day 2 cookies
  3. Sends to n8n webhook
  4. n8n updates both Apify actors with fresh cookies
  5. MMR VIN Scraper runs (scheduled 4 AM)
  6. Uses fresh Day 2 cookies

Day 3:
  1. Cookie Refresher runs (scheduled 3 AM)
  2. Uses Day 2 cookies → Extracts fresh Day 3 cookies
  3. Loop continues...
```

**Key Points:**
- ✅ No manual intervention needed after Day 1
- ✅ Cookies stay fresh (never expire)
- ✅ Both scrapers always have valid cookies
- ✅ Fully automated daily refresh

---

## ⚙️ Apify Scheduling

**Recommended Schedule:**

1. **Cookie Refresher:** Every day at **3:00 AM EST**
   - Runs first to get fresh cookies
   - Updates other scrapers via n8n

2. **MMR VIN Scraper:** Every day at **4:00 AM EST**
   - Runs 1 hour after cookie refresh
   - Uses fresh cookies from webhook

**Apify Schedule Settings:**
```
Cookie Refresher:
- Schedule: 0 3 * * * (3 AM daily)
- Timezone: America/New_York

MMR VIN Scraper:
- Schedule: 0 4 * * * (4 AM daily)
- Timezone: America/New_York
```

---

## 📊 Expected Performance

- **Duration:** ~1-2 minutes per run
- **Success Rate:** 95-99% (if yesterday's cookies valid)
- **Frequency:** Daily (or as needed)

**Timing Breakdown:**
- Navigate to site.manheim.com: ~10-15 seconds
- Human activity + click button: ~5-10 seconds
- Navigate to "LEARN MORE" page: ~3-5 seconds
- Go back: ~2-3 seconds
- Open MMR tool via URL: ~10-15 seconds
- Human activity + click VIN input: ~5-10 seconds
- Browser back button: ~3-5 seconds
- Check cookies + hard refresh (0-3x): ~0-45 seconds
- Final human activity: ~5-10 seconds
- Cookie extraction: ~1-2 seconds
- Webhook delivery: ~1-2 seconds
- **Total: ~45-122 seconds (worst case with 3 refreshes)**

---

## 🐛 Troubleshooting

### "Login page detected but no credentials provided"
- Cookies expired and no fallback credentials in input
- Add `credentials` object to input.json
- Or manually extract fresh cookies

### "2FA page detected but input field not found"
- MMR changed their 2FA page layout
- Check screenshot saved in key-value store: `2fa-input-not-found-screenshot`
- Update `detect2FAPage()` and `find2FAInput()` functions

### "2FA webhook failed with status 500"
- Your 2FA webhook is not responding
- Check n8n workflow is active
- Verify webhook URL is correct
- Test webhook manually with POST request
- Check n8n logs for errors

### "2FA webhook response did not contain a code"
- Webhook returned wrong format
- Response should be JSON: `{"code": "123456"}` or plain text: `123456`
- Check webhook logs to see what was returned

### "Session expired detected"
- Yesterday's cookies are too old or invalid
- Credentials will automatically log in (if provided)
- Extract fresh cookies manually
- Ensure daily scheduling is working

### "Missing cookies: _cl, SESSION, etc."
- The scraper couldn't find all 4 cookies
- May need to run 2FA login 2-3 more times to build trust
- Check Apify run logs
- Review "all-cookies-debug" in key-value store

### "CAPTCHA challenge detected"
- Manheim detected automation
- Wait 24 hours before retrying
- Consider adjusting delays (make them longer)
- Verify stealth plugins are working

### "Webhook failed (500)"
- Your cookie webhook is down or misconfigured
- Check n8n workflow is active
- Verify webhook URL is correct
- Check n8n logs for errors

---

## 🔐 Security Notes

- ⚠️ **Never commit cookies to Git**
- ⚠️ **Store cookies securely in Apify secrets or input**
- ⚠️ **Use HTTPS webhook only**
- ⚠️ **Rotate cookies daily** (this scraper does it automatically)
- ⚠️ **Monitor for failures** (set up alerts in n8n)

---

## 📞 n8n Integration Example

**n8n Workflow:**

```
1. Webhook Trigger (receive cookies)
   ↓
2. Check if success === true
   ↓
3. Extract cookies array
   ↓
4. HTTP Request → Update Cookie Refresher input (Apify API)
   {
     "manheimCookies": {{ cookies }}
   }
   ↓
5. HTTP Request → Update MMR VIN Scraper input (Apify API)
   {
     "manheimCookies": {{ cookies }}
   }
   ↓
6. Send success notification (email/Slack/etc)
```

**Apify API Endpoints:**
```
PUT https://api.apify.com/v2/acts/YOUR_ACTOR_ID/input
Headers:
  Authorization: Bearer YOUR_API_TOKEN
  Content-Type: application/json

Body:
{
  "manheimCookies": [...]
}
```

---

## 📞 Support

If you encounter issues:
1. Check Apify run logs for errors
2. Review "fresh-cookies" in key-value store
3. Verify webhook is receiving data (check n8n)
4. Check "all-cookies-debug" if extraction fails
5. Ensure yesterday's cookies are still valid

---

**Created for automated cookie management in the CarGurus Deal Analyzer system** 🚀

**Daily cookie refresh = Zero manual cookie extraction!** 🍪
