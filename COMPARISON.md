# 🔄 Cookie Refresher vs MMR VIN Scraper

**Side-by-side comparison of the two scrapers**

---

## 📊 Quick Overview

| Feature | Cookie Refresher | MMR VIN Scraper |
|---------|------------------|-----------------|
| **Purpose** | Extract fresh cookies daily | Scrape MMR values for VINs |
| **Input** | Yesterday's cookies | Fresh cookies + Supabase URL |
| **Output** | Fresh cookies → webhook | MMR data → webhook |
| **Duration** | ~47-79 seconds | ~5-10 minutes (100 VINs) |
| **Schedule** | Daily at 3 AM | Daily at 4 AM |
| **Dependencies** | None | Needs fresh cookies |
| **VIN Processing** | No | Yes (loops through VINs) |
| **Human Activity** | Yes (basic) | Yes (extensive) |
| **Stealth Level** | Medium | High |

---

## 🎯 Purpose & Goals

### Cookie Refresher
- **Goal:** Keep cookies fresh automatically
- **Why:** Manheim cookies expire after 24-48 hours
- **How:** Uses valid session to get new cookies
- **When:** Runs daily before MMR scraper

### MMR VIN Scraper
- **Goal:** Extract wholesale values for car listings
- **Why:** Calculate deal quality for CarGurus listings
- **How:** Looks up each VIN in Manheim MMR database
- **When:** Runs daily after cookies refreshed

---

## 🔄 Workflow Integration

```
┌─────────────────────────────────────────────────────────────┐
│                     DAILY WORKFLOW                           │
└─────────────────────────────────────────────────────────────┘

3:00 AM → Cookie Refresher (Apify scheduled)
          ├─ Input: Yesterday's cookies (Day N-1)
          ├─ Process: Navigate Manheim → Extract cookies
          └─ Output: Fresh cookies (Day N) → Webhook

          ↓ (n8n processes webhook)

3:05 AM → n8n Workflow
          ├─ Receives fresh cookies
          ├─ Updates Cookie Refresher input (for tomorrow)
          └─ Updates MMR VIN Scraper input (for today)

4:00 AM → MMR VIN Scraper (Apify scheduled)
          ├─ Input: Fresh cookies (Day N) + Supabase URL
          ├─ Process: Fetch VINs → Lookup MMR → Extract values
          └─ Output: MMR data → Webhook

          ↓ (n8n processes webhook)

4:30 AM → n8n Workflow
          ├─ Receives MMR data
          ├─ Calculates deal scores
          └─ Updates Supabase with results
```

---

## 📝 Input Comparison

### Cookie Refresher Input
```json
{
  "manheimCookies": [
    { "name": "_cl", "value": "...", "domain": ".manheim.com" },
    { "name": "SESSION", "value": "...", "domain": ".manheim.com" },
    { "name": "session", "value": "...", "domain": "mcom-header-footer.manheim.com" },
    { "name": "session.sig", "value": "...", "domain": "mcom-header-footer.manheim.com" }
  ],
  "cookieWebhookUrl": "https://n8n.../webhook/mmrcookies"
}
```

### MMR VIN Scraper Input
```json
{
  "manheimCookies": [
    { "name": "_cl", "value": "...", "domain": ".manheim.com" },
    { "name": "SESSION", "value": "...", "domain": ".manheim.com" },
    { "name": "session", "value": "...", "domain": "mcom-header-footer.manheim.com" },
    { "name": "session.sig", "value": "...", "domain": "mcom-header-footer.manheim.com" }
  ],
  "supabaseEdgeFunctionUrl": "https://...supabase.co/functions/v1/get-next-vin",
  "n8nWebhookUrl": "https://n8n.../webhook/MMR",
  "maxVINsPerRun": 100,
  "delayBetweenVINs": [3000, 8000]
}
```

**Key Difference:**
- Cookie Refresher: Only needs cookies + webhook
- MMR Scraper: Needs cookies + Supabase + webhook + processing config

---

## 📤 Output Comparison

### Cookie Refresher Output (to webhook)
```json
{
  "success": true,
  "timestamp": "2025-01-28T08:00:00Z",
  "cookies": [
    { "name": "_cl", "value": "FRESH_VALUE", ... },
    { "name": "SESSION", "value": "FRESH_VALUE", ... },
    { "name": "session", "value": "FRESH_VALUE", ... },
    { "name": "session.sig", "value": "FRESH_VALUE", ... }
  ]
}
```

### MMR VIN Scraper Output (to webhook)
```json
{
  "listing_id": 123,
  "vin": "1C6SRFFP6SN567235",
  "mmr_base_usd": 38500,
  "mmr_adjusted_usd": 38500,
  "mmr_range_min_usd": 36700,
  "mmr_range_max_usd": 40300,
  "estimated_retail_usd": 43300,
  "cargurus_price_cad": 54900
}
```

**Key Difference:**
- Cookie Refresher: Sends cookie objects
- MMR Scraper: Sends vehicle valuation data

---

## 🕐 Timing Comparison

### Cookie Refresher
```
Total: ~47-79 seconds (under 90 seconds)

Breakdown:
- Navigate to Manheim:      ~10-15s
- Human activity:           ~5-10s
- Navigate to MMR:          ~10-15s
- Navigate back to Manheim: ~10-15s
- Hard refresh (Ctrl+F5):   ~5-10s
- Final human activity:     ~5-10s
- Extract cookies:          ~1-2s
- Send webhook:             ~1-2s
```

### MMR VIN Scraper (100 VINs)
```
Total: ~5-10 minutes

Breakdown per VIN:
- Fetch VIN from Supabase:  ~1-2s
- Type VIN + search:        ~8-12s
- Input mileage:            ~5-8s
- Extract MMR values:       ~2-3s
- Send to webhook:          ~1-2s
- Delay to next VIN:        ~3-8s
---
Total per VIN:              ~20-35s
100 VINs:                   ~33-58 minutes
```

**Key Difference:**
- Cookie Refresher: Fast, single-purpose
- MMR Scraper: Slow, processes many VINs

---

## 🔒 Stealth Comparison

### Cookie Refresher
✅ Stealth plugins
✅ Human mouse movements
✅ Random scrolling
✅ Variable delays
✅ CAPTCHA detection
⚠️ Basic stealth (less activity)

**Rationale:** Only needs to access 2 pages briefly

### MMR VIN Scraper
✅ Stealth plugins
✅ Human-like typing (character-by-character)
✅ Mouse movements between actions
✅ Scrolling during waits
✅ Variable delays everywhere
✅ Jitter on all delays
✅ CAPTCHA detection
✅ Session recovery
⚠️ Advanced stealth (extensive activity)

**Rationale:** Processes 100+ VINs, needs to look very human

**Key Difference:**
- Cookie Refresher: Basic stealth (sufficient for quick task)
- MMR Scraper: Advanced stealth (necessary for long sessions)

---

## 🛠️ Error Handling

### Cookie Refresher
- ✅ CAPTCHA detection → Stop + screenshot
- ✅ Session expired → Error + manual refresh needed
- ✅ Missing cookies → Error + debug data saved
- ✅ Webhook failure → Error + retry
- ⚠️ No retry logic (runs daily anyway)

### MMR VIN Scraper
- ✅ CAPTCHA detection → Stop + screenshot
- ✅ Session expired → Error + need fresh cookies
- ✅ VIN not found → Mark as "not found" + continue
- ✅ Modal handling → Smart trim matching
- ✅ Page refresh on error → Recover and continue
- ✅ Webhook failure → Log error + continue to next VIN
- ⚠️ Advanced error recovery (critical for batch processing)

**Key Difference:**
- Cookie Refresher: Fail fast (runs daily, no big deal)
- MMR Scraper: Recover and continue (expensive to restart)

---

## 💰 Cost Comparison (Apify)

### Cookie Refresher
- **Compute Units:** ~0.01-0.02 per run
- **Daily:** ~0.01-0.02 CU/day
- **Monthly:** ~0.3-0.6 CU/month
- **Cost:** ~$0.03-0.06/month

### MMR VIN Scraper (100 VINs)
- **Compute Units:** ~0.15-0.25 per run
- **Daily:** ~0.15-0.25 CU/day
- **Monthly:** ~4.5-7.5 CU/month
- **Cost:** ~$0.45-0.75/month

**Key Difference:**
- Cookie Refresher: Very cheap (fast execution)
- MMR Scraper: More expensive (long execution)

**Combined Cost:** ~$0.50-0.80/month for both scrapers

---

## 🚨 Failure Scenarios

### Cookie Refresher Fails
**Impact:** MMR scraper will use yesterday's cookies
**Outcome:**
- If cookies still valid (24-48h) → MMR scraper works
- If cookies expired → MMR scraper fails too

**Recovery:**
1. Check Apify logs
2. Extract cookies manually
3. Update both inputs
4. Resume schedule

### MMR VIN Scraper Fails
**Impact:** No MMR data for today's VINs
**Outcome:**
- VINs remain in "processing" status
- Will be retried tomorrow

**Recovery:**
1. Check Apify logs
2. If cookie issue → Run cookie refresher manually
3. If VIN issue → Check Supabase
4. Restart scraper

---

## ✅ Success Indicators

### Cookie Refresher
1. ✅ All 4 cookies extracted
2. ✅ Webhook returns 200 OK
3. ✅ Backup saved to KV store
4. ✅ n8n updates both Apify inputs

### MMR VIN Scraper
1. ✅ 100 VINs processed
2. ✅ 85%+ success rate
3. ✅ All webhooks return 200 OK
4. ✅ n8n updates Supabase
5. ✅ No CAPTCHAs detected

---

## 📊 Monitoring Checklist

### Daily Checks
- [ ] Cookie refresher completed successfully (3 AM)
- [ ] Fresh cookies sent to webhook
- [ ] n8n updated both Apify inputs
- [ ] MMR scraper completed successfully (4 AM)
- [ ] VINs processed and updated in Supabase

### Weekly Checks
- [ ] No CAPTCHA challenges detected
- [ ] Success rate > 85%
- [ ] No cookie expiration errors
- [ ] Apify compute units within budget

### Monthly Checks
- [ ] Review failure patterns
- [ ] Optimize delays if needed
- [ ] Update stealth plugins
- [ ] Audit cookie security

---

## 🎯 Summary

**Cookie Refresher:**
- Fast, simple, cheap
- Runs first (3 AM)
- Keeps cookies fresh
- Enables automated workflow

**MMR VIN Scraper:**
- Slow, complex, more expensive
- Runs second (4 AM)
- Processes business logic
- Depends on fresh cookies

**Together:** Fully automated vehicle valuation pipeline! 🚀

---

**Last Updated:** 2025-01-28
