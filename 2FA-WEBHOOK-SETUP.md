# 2FA Webhook Setup Guide

This guide explains how to set up the 2FA webhook that retrieves verification codes automatically.

---

## 🎯 What the Webhook Does

1. Receives request from Cookie Refresher when 2FA page appears
2. Retrieves the 2FA code (from email, SMS, or authenticator app)
3. Returns the code to the scraper
4. Scraper enters the code automatically

---

## 🔧 Option 1: Email-Based 2FA (Recommended)

### Prerequisites
- Manheim sends 2FA codes to your email
- You have access to the email inbox via IMAP or API

### n8n Workflow

```
┌─────────────────────────────────────────┐
│ 1. Webhook Trigger (POST)              │
│    Path: /webhook/mmr2facode            │
│    Returns: Immediately with response   │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ 2. Gmail/IMAP Node                      │
│    Action: Search for latest email      │
│    From: noreply@manheim.com            │
│    Subject: "Verification Code"         │
│    Received: Last 5 minutes             │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ 3. Extract Code (Function/Code Node)   │
│    Regex: /\b\d{6}\b/                  │
│    Example: "Your code is 123456"      │
│    Extracted: "123456"                  │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ 4. Respond to Webhook                   │
│    Return JSON:                         │
│    {                                    │
│      "code": "123456"                   │
│    }                                    │
└─────────────────────────────────────────┘
```

### n8n Nodes Configuration

**Node 1: Webhook Trigger**
```json
{
  "httpMethod": "POST",
  "path": "mmr2facode",
  "responseMode": "lastNode",
  "options": {}
}
```

**Node 2: Gmail (or IMAP)**
```json
{
  "operation": "search",
  "filters": {
    "from": "noreply@manheim.com",
    "subject": "verification code",
    "receivedAfter": "{{ $now.minus({minutes: 5}).toISO() }}"
  },
  "format": "simple",
  "limit": 1
}
```

**Node 3: Code Node (Extract 2FA Code)**
```javascript
// Get email body
const emailBody = $input.item.json.text || $input.item.json.html || '';

// Extract 6-digit code using regex
const codeMatch = emailBody.match(/\b\d{6}\b/);

if (!codeMatch) {
  throw new Error('Could not find 6-digit code in email');
}

return {
  code: codeMatch[0]
};
```

**Node 4: Respond to Webhook**
```json
{
  "options": {
    "responseCode": 200,
    "responseHeaders": {
      "Content-Type": "application/json"
    }
  },
  "responseBody": "={{ { \"code\": $json.code } }}"
}
```

---

## 🔧 Option 2: SMS-Based 2FA

If Manheim sends codes via SMS:

### Using Twilio

```
┌─────────────────────────────────────────┐
│ 1. Webhook Trigger                      │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ 2. Twilio Node                          │
│    Action: Get Messages                 │
│    From: Manheim                        │
│    Received: Last 5 minutes             │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ 3. Extract Code (Regex)                 │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ 4. Respond to Webhook                   │
└─────────────────────────────────────────┘
```

### Using Vonage (Nexmo)

Similar to Twilio - use API to fetch recent SMS messages.

---

## 🔧 Option 3: Authenticator App (TOTP)

If using Google Authenticator, Authy, etc.:

### Prerequisites
- You have the TOTP secret key
- Install `otp-generator` or similar library in n8n

### n8n Workflow

```
┌─────────────────────────────────────────┐
│ 1. Webhook Trigger                      │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ 2. Function Node                        │
│    Generate TOTP code from secret       │
│    Using TOTP algorithm (RFC 6238)      │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ 3. Respond to Webhook                   │
└─────────────────────────────────────────┘
```

**Code Node (Generate TOTP):**
```javascript
const crypto = require('crypto');

// Your Manheim TOTP secret (get from QR code setup)
const secret = 'YOUR_TOTP_SECRET_HERE';

function generateTOTP(secret) {
  const time = Math.floor(Date.now() / 1000 / 30);
  const timeHex = time.toString(16).padStart(16, '0');
  const timeBuffer = Buffer.from(timeHex, 'hex');

  const hmac = crypto.createHmac('sha1', Buffer.from(secret, 'base32'));
  hmac.update(timeBuffer);
  const hash = hmac.digest();

  const offset = hash[hash.length - 1] & 0xf;
  const binary = ((hash[offset] & 0x7f) << 24) |
                 ((hash[offset + 1] & 0xff) << 16) |
                 ((hash[offset + 2] & 0xff) << 8) |
                 (hash[offset + 3] & 0xff);

  const otp = binary % 1000000;
  return otp.toString().padStart(6, '0');
}

return {
  code: generateTOTP(secret)
};
```

---

## 🧪 Testing Your Webhook

### Test with cURL

```bash
curl -X POST https://n8nsaved-production.up.railway.app/webhook/mmr2facode \
  -H "Content-Type: application/json" \
  -d '{"username": "test@example.com"}'
```

**Expected Response:**
```json
{
  "code": "123456"
}
```

### Test with Postman

1. Method: POST
2. URL: `https://n8nsaved-production.up.railway.app/webhook/mmr2facode`
3. Body (JSON):
```json
{
  "username": "your@email.com"
}
```
4. Send → Should return `{"code": "123456"}`

---

## 📊 Webhook Response Formats

The scraper accepts multiple response formats:

### Format 1: JSON with "code" key (Recommended)
```json
{
  "code": "123456"
}
```

### Format 2: JSON with alternative keys
```json
{ "2fa_code": "123456" }
{ "otp": "123456" }
{ "token": "123456" }
```

### Format 3: Plain text
```
123456
```

---

## ⚠️ Important Considerations

### Timing
- Webhook must respond within **30 seconds**
- 2FA codes expire in **5-10 minutes**
- Email/SMS may take **10-60 seconds** to arrive

### Error Handling
- If email not found → return error or wait & retry
- If code extraction fails → log full email body for debugging
- If webhook times out → scraper will fail and retry next run

### Security
- Use HTTPS for webhook URL
- Don't log sensitive codes in plain text
- Restrict webhook access (if possible)
- Monitor for suspicious webhook calls

### Reliability Tips
- Test webhook thoroughly before first run
- Monitor n8n workflow executions
- Set up alerts for webhook failures
- Keep n8n workflow simple (fewer failure points)

---

## 🐛 Troubleshooting

### "2FA webhook failed with status 500"
- Check n8n workflow is active
- Review n8n execution logs
- Test webhook manually with cURL

### "2FA webhook response did not contain a code"
- Webhook returned wrong format
- Check webhook response in n8n logs
- Verify JSON structure

### "Could not find 6-digit code in email"
- Email not received yet (wait longer)
- Email subject/body changed (update filters)
- Regex pattern needs adjustment

### Webhook times out
- Email taking too long to arrive
- Increase webhook timeout in n8n
- Add retry logic in n8n workflow

---

## 🎯 Recommended Setup

For most users, **Email-based 2FA** is the easiest and most reliable:

1. ✅ No additional hardware/apps needed
2. ✅ Easy to debug (can view emails)
3. ✅ Reliable delivery
4. ✅ Simple n8n workflow

**Setup time:** 10-15 minutes
**Reliability:** 95%+

---

## 📞 Example Email Formats

### Manheim 2FA Email Example
```
From: noreply@manheim.com
Subject: Your Manheim Verification Code

Your verification code is: 123456

This code expires in 10 minutes.

If you did not request this code, please contact support.
```

### Regex Patterns
```javascript
// Simple 6-digit code
/\b\d{6}\b/

// Code with context
/verification code[:\s]+(\d{6})/i

// Code with HTML formatting
/<strong>(\d{6})<\/strong>/
```

---

**Ready to implement?** Choose your option and set up the webhook in n8n!
