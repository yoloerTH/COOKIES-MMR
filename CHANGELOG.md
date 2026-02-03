# Changelog - Cookie Refresher v2.0

## 🚀 Major Changes

### 1. Persistent Browser Profile
- **Before:** Browser launched fresh every run (no memory)
- **After:** Uses `./manheim_browser_profile` folder to persist everything between runs
- **Why:** MMR recognizes the same browser and builds trust over time
- **Impact:** After ~3 2FA logins, cookies last longer and hard refresh works better

### 2. Credential Login Fallback
- **Before:** Required valid cookies or scraper would fail
- **After:** Automatically logs in with username/password if cookies expire
- **Why:** No manual intervention needed when cookies expire
- **Impact:** Fully autonomous operation

### 3. 2FA Automation
- **Before:** No 2FA support
- **After:** Calls webhook to retrieve 2FA code and enters it automatically
- **Why:** Complete end-to-end automation
- **Impact:** Zero manual 2FA entry needed

---

## 📝 Code Changes

### Added Functions

#### `detectLoginPage(page)`
- Detects if login page is shown
- Looks for `input#username` and `input#password` elements
- Returns boolean

#### `detect2FAPage(page)`
- Smart detection of 2FA verification pages
- Checks for:
  - Text: "verification code", "authentication code", "2fa", "otp"
  - Input fields with maxLength 4-8 (typical for codes)
  - Input names/IDs containing "code", "otp", "token"
- Returns boolean

#### `find2FAInput(page)`
- Finds the 2FA code input field
- Uses multiple detection strategies:
  - Strong match: ID/name contains "code", "otp"
  - Length match: maxLength 4-8 chars
  - Type match: text/number/tel inputs
- Returns CSS selector string

### Modified Browser Launch

**Before:**
```javascript
const browser = await chromium.launch({...});
const context = await browser.newContext({...});
await context.addCookies(manheimCookies);
const page = await context.newPage();
```

**After:**
```javascript
const context = await chromium.launchPersistentContext('./manheim_browser_profile', {...});
if (manheimCookies && manheimCookies.length > 0) {
    await context.addCookies(manheimCookies);
}
const page = context.pages()[0] || await context.newPage();
```

### Added Login Flow

After homepage loads:
1. Check if login page detected
2. If yes and credentials provided:
   - Fill username (`input#username`)
   - Fill password (`input#password`)
   - Check "Remember my username" (`input#rememberUsername`)
   - Click submit button
   - Wait for page load
3. Check if 2FA page detected
4. If yes:
   - Call webhook: `POST https://n8nsaved-production.up.railway.app/webhook/mmr2facode`
   - Wait for response
   - Parse code (JSON or plain text)
   - Enter code
   - Click submit
   - Wait for verification

### Updated Input Schema

**New fields:**
```json
{
  "credentials": {
    "username": "your@email.com",
    "password": "yourpassword"
  },
  "twoFactorWebhookUrl": "https://n8nsaved-production.up.railway.app/webhook/mmr2facode"
}
```

**Changed validation:**
- Before: `manheimCookies` was required
- After: Either `manheimCookies` OR `credentials` required

---

## 🔄 Workflow Changes

### Old Workflow
```
Day 1: Manual cookie extraction
Day 2+: Automated cookie refresh (if Day 1 cookies valid)
```

### New Workflow
```
Day 1: Provide credentials
Day 2+:
  - If cookies valid → refresh cookies
  - If cookies expired → login with credentials → 2FA → get cookies
  - Browser profile builds trust over time
  - After ~3 2FA logins → cookies last longer
```

---

## 📦 Files Changed

1. **src/main.js**
   - Added login detection functions
   - Added 2FA detection functions
   - Changed browser launch to persistent context
   - Added login flow after homepage load
   - Added 2FA flow after login
   - Updated input validation
   - Updated cleanup (context.close() vs browser.close())

2. **input.example.json**
   - Added `credentials` object
   - Added `twoFactorWebhookUrl` field
   - Updated `cookieWebhookUrl` to new URL

3. **README.md**
   - Added "New Features" section
   - Updated "What It Does" flow
   - Added "2FA Webhook Integration" section
   - Added "Persistent Browser Profile" section
   - Updated "Input Configuration"
   - Updated "Anti-Ban Features"
   - Updated "Troubleshooting"

---

## 🎯 Expected Behavior

### First 3 Runs (Building Trust)
- Run 1: Login with credentials → 2FA → cookies extracted → profile saved
- Run 2: Login with credentials → 2FA → cookies extracted → profile updated
- Run 3: Login with credentials → 2FA → cookies extracted → **browser now trusted**

### Runs 4+ (Trusted Browser)
- Cookies from previous run still valid
- Hard refresh generates new cookies
- No login/2FA needed (unless cookies expire)
- Much faster and more reliable

---

## ⚠️ Important Notes

1. **Browser Profile Folder**
   - Location: `./manheim_browser_profile`
   - Created automatically on first run
   - DO NOT delete between runs
   - DO NOT commit to Git (add to .gitignore)

2. **2FA Webhook Requirements**
   - Must respond within 30 seconds (default timeout)
   - Response format: JSON `{"code": "123456"}` or plain text `123456`
   - Should retrieve code from email/SMS/authenticator

3. **Security**
   - Store credentials securely in Apify secrets
   - Use HTTPS webhooks only
   - Monitor for suspicious activity

4. **Building Trust**
   - Be patient - takes 2-3 2FA logins to build trust
   - Don't delete browser profile folder
   - Run daily at consistent times
   - Use same Apify actor instance

---

## 🧪 Testing Checklist

- [ ] First run with credentials (no cookies)
- [ ] Login flow works correctly
- [ ] 2FA webhook is called
- [ ] 2FA code is entered correctly
- [ ] Cookies are extracted after successful 2FA
- [ ] Browser profile folder is created
- [ ] Second run reuses browser profile
- [ ] Cookies are refreshed without login
- [ ] Cookie webhook receives fresh cookies
- [ ] Third run further improves trust

---

**Version:** 2.0
**Date:** 2025-02-04
**Breaking Changes:** None (backwards compatible with v1.0 input)
