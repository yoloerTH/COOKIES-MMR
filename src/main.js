import { Actor } from 'apify';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// Add stealth plugin
chromium.use(StealthPlugin());

// ============================================
// BROWSER PROFILE PERSISTENCE
// ============================================

const PROFILE_DIR = './manheim_browser_profile';
const PROFILE_KV_KEY = 'browser-profile';
const COOKIES_KV_KEY = 'saved-cookies';
const FINGERPRINT_KV_KEY = 'browser-fingerprint';
const PROFILE_KV_STORE_NAME = 'mmr-cookies';
const PROFILE_TAR = '/tmp/browser-profile.tar.gz';

// Stable browser fingerprint — must stay consistent across runs so
// PingFederate's device recognition sees the same "device" every time.
const DEFAULT_FINGERPRINT = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    screen: { width: 1920, height: 1080 },
    locale: 'en-CA',
    timezoneId: 'America/Edmonton',
    platform: 'Win32',
    deviceScaleFactor: 1,
};

// Directories to exclude when saving (large/unnecessary cache files)
const EXCLUDE_DIRS = [
    'Cache', 'Code Cache', 'GPUCache', 'ShaderCache',
    'Service Worker', 'blob_storage', 'BrowserMetrics',
    'crash_reports', 'component_cracked_packs', 'GrShaderCache',
    'optimization_guide_prediction_model_downloads',
];

async function restoreBrowserProfile() {
    console.log('\n💾 Checking for saved browser profile in KV store...');

    try {
        const store = await Actor.openKeyValueStore(PROFILE_KV_STORE_NAME);
        const profileData = await store.getValue(PROFILE_KV_KEY);

        if (!profileData) {
            console.log('  → No saved profile found - starting fresh');
            return false;
        }

        // profileData is a Buffer from KV store
        const buffer = Buffer.from(profileData);
        console.log(`  → Found saved profile (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);

        // Write tarball to disk
        fs.writeFileSync(PROFILE_TAR, buffer);

        // Create profile directory and extract
        fs.mkdirSync(PROFILE_DIR, { recursive: true });
        execSync(`tar xzf ${PROFILE_TAR} -C ${PROFILE_DIR}`, { stdio: 'pipe' });

        // Clean up tarball
        fs.unlinkSync(PROFILE_TAR);

        console.log('  ✅ Browser profile restored from KV store');
        return true;
    } catch (error) {
        console.log(`  ⚠️ Failed to restore profile: ${error.message}`);
        console.log('  → Starting with fresh profile');
        return false;
    }
}

async function saveBrowserProfile() {
    console.log('\n💾 Saving browser profile to KV store...');

    try {
        if (!fs.existsSync(PROFILE_DIR)) {
            console.log('  ⚠️ Profile directory does not exist - nothing to save');
            return false;
        }

        // Build tar exclude flags
        const excludeFlags = EXCLUDE_DIRS.map(d => `--exclude='${d}'`).join(' ');

        // Create tarball (from inside profile dir so paths are relative)
        execSync(`tar czf ${PROFILE_TAR} ${excludeFlags} -C ${PROFILE_DIR} .`, { stdio: 'pipe' });

        // Read tarball
        const tarData = fs.readFileSync(PROFILE_TAR);
        const sizeMB = (tarData.length / 1024 / 1024).toFixed(2);
        console.log(`  → Profile size: ${sizeMB} MB`);

        // Save to KV store (binary data, application/octet-stream)
        const store = await Actor.openKeyValueStore(PROFILE_KV_STORE_NAME);
        await store.setValue(PROFILE_KV_KEY, tarData, { contentType: 'application/octet-stream' });

        // Clean up tarball
        fs.unlinkSync(PROFILE_TAR);

        console.log(`  ✅ Browser profile saved to KV store (${sizeMB} MB)`);
        return true;
    } catch (error) {
        console.log(`  ⚠️ Failed to save profile: ${error.message}`);
        return false;
    }
}

// ============================================
// COOKIE PERSISTENCE (KV Store)
// ============================================

async function restoreSavedCookies() {
    console.log('\n🍪 Checking for saved cookies in KV store...');
    try {
        const store = await Actor.openKeyValueStore(PROFILE_KV_STORE_NAME);
        const savedCookies = await store.getValue(COOKIES_KV_KEY);

        if (!savedCookies || !Array.isArray(savedCookies) || savedCookies.length === 0) {
            console.log('  → No saved cookies found');
            return null;
        }

        console.log(`  ✅ Found ${savedCookies.length} saved cookies from previous run`);

        // Fix expired cookies: if a cookie has a past expiry timestamp,
        // convert it to a session cookie (remove expires) so Playwright accepts it.
        // This mimics a browser that stayed open (session cookies don't expire until close).
        const now = Date.now() / 1000;
        let fixedCount = 0;
        const fixedCookies = savedCookies.map(cookie => {
            if (cookie.expires && cookie.expires > 0 && cookie.expires < now) {
                fixedCount++;
                const { expires, ...rest } = cookie;
                return { ...rest, expires: -1 };
            }
            return cookie;
        });

        if (fixedCount > 0) {
            console.log(`  → Fixed ${fixedCount} expired cookies (converted to session cookies)`);
        }

        return fixedCookies;
    } catch (error) {
        console.log(`  ⚠️ Failed to restore cookies: ${error.message}`);
        return null;
    }
}

async function saveCookiesToKV(cookieArray) {
    console.log('\n💾 Saving cookies to KV store for next run...');
    try {
        const store = await Actor.openKeyValueStore(PROFILE_KV_STORE_NAME);
        await store.setValue(COOKIES_KV_KEY, cookieArray);
        console.log(`  ✅ Saved ${cookieArray.length} cookies to KV store`);
        return true;
    } catch (error) {
        console.log(`  ⚠️ Failed to save cookies: ${error.message}`);
        return false;
    }
}

// ============================================
// BROWSER FINGERPRINT PERSISTENCE
// ============================================

async function getStableFingerprint() {
    console.log('\n🖥️ Loading stable browser fingerprint...');
    try {
        const store = await Actor.openKeyValueStore(PROFILE_KV_STORE_NAME);
        const saved = await store.getValue(FINGERPRINT_KV_KEY);

        if (saved) {
            console.log('  ✅ Loaded fingerprint from KV store (consistent with previous runs)');
            console.log(`  → User-Agent: ${saved.userAgent.substring(saved.userAgent.indexOf('Chrome'))}`);
            console.log(`  → Viewport: ${saved.viewport.width}x${saved.viewport.height}`);
            console.log(`  → Locale: ${saved.locale} | TZ: ${saved.timezoneId}`);
            return saved;
        }

        // First run — save the default fingerprint
        console.log('  → No saved fingerprint — creating and saving default');
        await store.setValue(FINGERPRINT_KV_KEY, DEFAULT_FINGERPRINT);
        console.log(`  ✅ Fingerprint saved to KV store`);
        console.log(`  → User-Agent: ${DEFAULT_FINGERPRINT.userAgent.substring(DEFAULT_FINGERPRINT.userAgent.indexOf('Chrome'))}`);
        return DEFAULT_FINGERPRINT;
    } catch (error) {
        console.log(`  ⚠️ Failed to load fingerprint: ${error.message} — using default`);
        return DEFAULT_FINGERPRINT;
    }
}

// ============================================
// URL HELPER
// ============================================

function getHostname(url) {
    try {
        return new URL(url).hostname;
    } catch {
        return '';
    }
}

// ============================================
// HUMAN-LIKE BEHAVIOR HELPERS
// ============================================

// Add random jitter to make patterns less predictable
function jitter() {
    return Math.floor(Math.random() * 80) - 40; // -40 to +40 random offset
}

async function humanDelay(min = 1000, max = 3000) {
    const baseDelay = Math.random() * (max - min) + min;
    const delay = baseDelay + jitter(); // Add jitter to delay
    await new Promise(resolve => setTimeout(resolve, Math.max(100, delay))); // Min 100ms
}

async function simulateHumanMouse(page) {
    // More variable mouse positions with jitter
    const baseX = Math.floor(Math.random() * 600) + 50;
    const baseY = Math.floor(Math.random() * 600) + 50;
    const x = baseX + jitter();
    const y = baseY + jitter();

    // Variable number of steps (8-15 instead of always 10)
    const steps = Math.floor(Math.random() * 8) + 8;

    await page.mouse.move(x, y, { steps });
    await humanDelay(300, 800);
}

async function simulateHumanScroll(page) {
    // More variable scroll amounts with jitter
    const baseScroll = Math.floor(Math.random() * 400) + 150;
    const scrollAmount = baseScroll + jitter();

    await page.evaluate((amount) => {
        window.scrollBy({
            top: amount,
            behavior: 'smooth'
        });
    }, scrollAmount);
    await humanDelay(500, 1000);
}

// ============================================
// LOGIN & 2FA DETECTION
// ============================================

async function detectLoginPage(page) {
    console.log('  → Checking if login page is displayed...');

    const isLoginPage = await page.evaluate(() => {
        const usernameField = document.querySelector('input#username');
        const passwordField = document.querySelector('input#password');
        return !!(usernameField && passwordField);
    });

    if (isLoginPage) {
        console.log('  ⚠️ Login page detected - credentials required!');
    } else {
        console.log('  ✅ Not a login page - session is valid');
    }

    return isLoginPage;
}

async function detect2FAPage(page) {
    console.log('  → Checking if 2FA page is displayed...');

    const is2FAPage = await page.evaluate(() => {
        const pageText = document.body.textContent.toLowerCase();

        // Check for common 2FA text patterns
        const has2FAText = pageText.includes('verification code') ||
                          pageText.includes('authentication code') ||
                          pageText.includes('enter code') ||
                          pageText.includes('two-factor') ||
                          pageText.includes('2fa') ||
                          pageText.includes('otp') ||
                          pageText.includes('security code');

        // Check for input fields that look like 2FA code inputs
        const inputs = Array.from(document.querySelectorAll('input'));
        const has2FAInput = inputs.some(input => {
            const id = (input.id || '').toLowerCase();
            const name = (input.name || '').toLowerCase();
            const placeholder = (input.placeholder || '').toLowerCase();
            const type = input.type;
            const maxLength = input.maxLength;

            // Common 2FA input patterns
            const nameMatch = id.includes('code') || id.includes('otp') || id.includes('token') ||
                            name.includes('code') || name.includes('otp') || name.includes('token') ||
                            placeholder.includes('code') || placeholder.includes('verification');

            // 2FA inputs usually have maxLength of 6-8
            const lengthMatch = maxLength >= 4 && maxLength <= 8;

            // Usually text or number type
            const typeMatch = type === 'text' || type === 'number' || type === 'tel';

            return (nameMatch || lengthMatch) && typeMatch;
        });

        return has2FAText || has2FAInput;
    });

    if (is2FAPage) {
        console.log('  ⚠️ 2FA page detected - code required!');
    } else {
        console.log('  ✅ Not a 2FA page');
    }

    return is2FAPage;
}

async function find2FAInput(page) {
    console.log('  → Finding 2FA code input field...');

    const inputSelector = await page.evaluate(() => {
        // Try known MMR selectors first
        const knownSelectors = ['#passcode', 'input[name="otp"]'];
        for (const selector of knownSelectors) {
            const input = document.querySelector(selector);
            if (input) {
                return selector;
            }
        }

        // Fallback: Generic detection
        const inputs = Array.from(document.querySelectorAll('input'));

        // Try to find the most likely 2FA input
        for (const input of inputs) {
            const id = (input.id || '').toLowerCase();
            const name = (input.name || '').toLowerCase();
            const placeholder = (input.placeholder || '').toLowerCase();
            const type = input.type;
            const maxLength = input.maxLength;

            // Strong indicators
            const strongMatch = id.includes('code') || id.includes('otp') || id.includes('passcode') ||
                              name.includes('code') || name.includes('otp') ||
                              placeholder.includes('code');

            // Length indicator (6-8 chars is typical for 2FA)
            const lengthMatch = maxLength >= 4 && maxLength <= 8;

            // Type indicator
            const typeMatch = type === 'text' || type === 'number' || type === 'tel';

            if (strongMatch && typeMatch) {
                return input.id ? `#${input.id}` : `input[name="${input.name}"]`;
            }

            if (lengthMatch && typeMatch && input.type !== 'password') {
                return input.id ? `#${input.id}` : `input[type="${type}"][maxlength="${maxLength}"]`;
            }
        }

        return null;
    });

    if (inputSelector) {
        console.log(`  ✅ Found 2FA input: ${inputSelector}`);
    } else {
        console.log('  ❌ Could not find 2FA input field');
    }

    return inputSelector;
}

// ============================================
// LOGIN FLOW HANDLER
// ============================================

async function handleLoginFlow(page, credentials, twoFactorWebhookUrl) {
    console.log('\n🔐 LOGIN FLOW: Entering credentials...');
    console.log(`  → Username: ${credentials.username}`);

    // Wait for login form to be ready
    console.log('  → Waiting for login form to load...');
    await page.waitForSelector('input#username', { timeout: 15000 });

    // Fill username
    console.log('  → Filling username field...');
    await page.fill('input#username', credentials.username);
    await humanDelay(500, 1000);

    // Fill password
    console.log('  → Filling password field...');
    await page.fill('input#password', credentials.password);
    await humanDelay(500, 1000);

    // Check "Remember my username" if available
    try {
        console.log('  → Checking "Remember my username"...');

        const checkbox = page.locator('input#rememberUsername');
        if (await checkbox.count() > 0) {
            // Check current state first
            const alreadyChecked = await checkbox.isChecked();
            console.log(`  → Checkbox current state: ${alreadyChecked ? 'CHECKED' : 'UNCHECKED'}`);

            if (!alreadyChecked) {
                // Use Playwright's .check() which ensures the checkbox ends up checked
                await checkbox.check({ force: true, timeout: 3000 });
            }

            // Verify it's actually checked
            const isNowChecked = await checkbox.isChecked();
            console.log(`  → Checkbox after action: ${isNowChecked ? '✅ CHECKED' : '❌ STILL UNCHECKED'}`);

            if (!isNowChecked) {
                // Fallback: click the container div
                console.log('  → Fallback: clicking container div...');
                await page.locator('.ping-checkbox-container:has-text("Remember")').first().click({ timeout: 3000 });
                const finalState = await checkbox.isChecked();
                console.log(`  → Checkbox final state: ${finalState ? '✅ CHECKED' : '❌ STILL UNCHECKED'}`);
            }
        } else {
            console.log('  → Remember username checkbox not found on page');
        }

        await humanDelay(500, 1000);
    } catch (e) {
        console.log('  → Remember username checkbox error (skipping)');
        console.log(`  → Error: ${e.message}`);
    }

    // Find and click submit button (MMR uses <a> tag with id="signOnButton")
    console.log('  → Looking for Sign In button...');
    const submitSelectors = [
        'a#signOnButton',  // MMR specific
        'button#signOnButton',
        'a.ping-button:has-text("Sign In")',
        'button[type="submit"]',
        'input[type="submit"]',
        'button:has-text("Sign In")',
        'button:has-text("Log In")',
        'a:has-text("Sign In")'
    ];

    let submitButton = null;
    for (const selector of submitSelectors) {
        try {
            const button = page.locator(selector).first();
            const count = await button.count();
            if (count > 0) {
                submitButton = button;
                console.log(`  ✅ Found Sign In button: ${selector}`);
                break;
            }
        } catch (e) {
            // Try next selector
        }
    }

    if (!submitButton) {
        throw new Error('Could not find Sign In button');
    }

    console.log('  → Clicking Sign In button...');
    await submitButton.click();
    console.log('  ✅ Login form submitted');

    // Wait for navigation after login
    console.log('  → Waiting for page to load after login...');
    await humanDelay(4000, 6000);

    // Check if 2FA page appeared
    const is2FAPage = await detect2FAPage(page);
    if (is2FAPage) {
        console.log('\n🔐 2FA FLOW: Getting verification code...');

        // Find 2FA input field
        const twoFAInput = await find2FAInput(page);
        if (!twoFAInput) {
            console.error('❌ Could not find 2FA input field!');
            const screenshot = await page.screenshot({ fullPage: false });
            await Actor.setValue('2fa-input-not-found-screenshot', screenshot, { contentType: 'image/png' });
            throw new Error('2FA page detected but input field not found');
        }

        // Call 2FA webhook and wait for code (5 minute timeout)
        console.log(`  → Calling 2FA webhook: ${twoFactorWebhookUrl}`);
        console.log('  → Waiting up to 5 minutes for your response...');

        let twoFACode = null;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minutes

            const twoFAResponse = await fetch(twoFactorWebhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: credentials.username }),
                signal: controller.signal
            }).finally(() => clearTimeout(timeoutId));

            if (!twoFAResponse.ok) {
                const errorText = await twoFAResponse.text().catch(() => 'No error details');
                throw new Error(`2FA webhook failed with status ${twoFAResponse.status}: ${errorText}`);
            }

            const responseText = await twoFAResponse.text();
            console.log(`  → Webhook response received: ${responseText.substring(0, 100)}...`);

            // Parse 2FA code (try JSON first, fallback to plain text)
            try {
                const jsonResponse = JSON.parse(responseText);

                // If JSON is a primitive (number or string), use it directly
                if (typeof jsonResponse === 'number' || typeof jsonResponse === 'string') {
                    twoFACode = String(jsonResponse).trim();
                    console.log('  → Parsed as JSON primitive:', twoFACode);
                } else if (typeof jsonResponse === 'object') {
                    // If JSON is an object, look for code in known fields
                    twoFACode = jsonResponse.code || jsonResponse['2fa_code'] || jsonResponse.otp || jsonResponse.token;
                    console.log('  → Parsed as JSON object');
                }
            } catch (e) {
                // Not JSON, treat as plain text
                twoFACode = responseText.trim();
                console.log('  → Parsed as plain text');
            }

            if (!twoFACode) {
                throw new Error('2FA webhook response did not contain a code');
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error('2FA webhook timed out after 5 minutes - no response received');
            }
            throw error;
        }

        console.log(`  ✅ 2FA code received: ${twoFACode}`);

        // Enter 2FA code
        console.log('  → Entering 2FA code...');
        await page.fill(twoFAInput, twoFACode);
        console.log('  ✅ Code entered');

        // Check for "Don't ask again" / "Trust this device" checkbox
        console.log('  → Looking for "trust this device" checkbox...');
        const trustSelectors = [
            'input#otp-remember',
            'input[name="otp-remember"]',
            'input#rememberDevice',
            'input[name="rememberDevice"]',
            'label:has-text("Don\'t ask")',
            'label:has-text("Remember this")',
            'label:has-text("Trust this")',
            '.ping-checkbox-container:has-text("Don\'t ask")',
            '.ping-checkbox-container:has-text("Remember")',
            '.ping-checkbox-container:has-text("Trust")'
        ];

        let trustChecked = false;
        for (const selector of trustSelectors) {
            try {
                const el = page.locator(selector).first();
                if (await el.count() > 0 && await el.isVisible()) {
                    await el.click();
                    trustChecked = true;
                    console.log(`  ✅ Checked "trust this device" (${selector})`);
                    break;
                }
            } catch (e) {
                // Try next selector
            }
        }
        if (!trustChecked) {
            console.log('  → No "trust this device" checkbox found (may not be available)');
        }

        // Wait for button to become enabled (checkInput() function needs to run)
        console.log('  → Waiting for Sign In button to become enabled...');
        await humanDelay(1000, 2000);

        // Find submit button (try multiple selectors)
        console.log('  → Looking for submit button...');
        const buttonSelectors = [
            'button#sign-on',  // Specific to MMR
            'button:has-text("Sign In")',
            'button[type="submit"]',
            'input[type="submit"]',
            'button:has-text("Submit")',
            'button:has-text("Verify")',
            'button:has-text("Continue")'
        ];

        let twoFASubmit = null;
        for (const selector of buttonSelectors) {
            try {
                const button = page.locator(selector).first();
                const count = await button.count();
                if (count > 0) {
                    twoFASubmit = button;
                    console.log(`  ✅ Found button: ${selector}`);
                    break;
                }
            } catch (e) {
                // Try next selector
            }
        }

        if (!twoFASubmit) {
            throw new Error('Could not find 2FA submit button');
        }

        // Wait for button to be enabled (disabled attribute removed)
        console.log('  → Waiting for button to be clickable...');
        await twoFASubmit.waitFor({ state: 'visible', timeout: 10000 });

        // Additional wait to ensure button is enabled
        await humanDelay(500, 1000);

        // Click submit button
        console.log('  → Clicking Sign In button...');
        await twoFASubmit.click({ force: false, timeout: 10000 });
        console.log('  ✅ 2FA code submitted');

        // Wait for 2FA verification
        console.log('  → Waiting for 2FA verification...');
        await humanDelay(4000, 6000);
    }

    console.log('✅ Login flow completed - session established!');
}

// ============================================
// CAPTCHA & ERROR DETECTION
// ============================================

async function detectCaptchaOrBlocking(page, pageName = 'page') {
    console.log(`  → Checking for CAPTCHA/blocking on ${pageName}...`);

    const blockingStatus = await page.evaluate(() => {
        const text = document.body.textContent.toLowerCase();
        const html = document.documentElement.innerHTML.toLowerCase();
        const visibleText = document.body.innerText.toLowerCase();

        // More specific CAPTCHA detection - look for actual CAPTCHA elements
        const hasRecaptchaElement = !!document.querySelector('.g-recaptcha') ||
                                   !!document.querySelector('[data-sitekey]') ||
                                   !!document.querySelector('iframe[src*="recaptcha"]');

        const hasHcaptchaElement = !!document.querySelector('.h-captcha') ||
                                  !!document.querySelector('iframe[src*="hcaptcha"]');

        const hasCaptchaIframe = !!document.querySelector('iframe[src*="captcha"]');

        // Only flag as CAPTCHA if we see actual CAPTCHA UI elements or very specific text
        const hasCaptchaChallenge = (visibleText.includes('complete the captcha') ||
                                    visibleText.includes('solve the captcha') ||
                                    visibleText.includes('verify you are human') ||
                                    visibleText.includes('verify you\'re human') ||
                                    visibleText.includes('i am not a robot')) &&
                                   (hasRecaptchaElement || hasHcaptchaElement || hasCaptchaIframe);

        return {
            hasCaptcha: hasCaptchaChallenge,
            hasRecaptcha: hasRecaptchaElement,
            hasHcaptcha: hasHcaptchaElement,
            hasCloudflare: (text.includes('cloudflare') && text.includes('checking your browser')) ||
                          (text.includes('challenge') && text.includes('ray id')),
            hasAccessDenied: text.includes('access denied') ||
                           text.includes('403 forbidden') ||
                           text.includes('not authorized'),
            hasSessionExpired: text.includes('session expired') ||
                             text.includes('please log in') ||
                             text.includes('login required'),
            hasRateLimit: text.includes('too many requests') ||
                         text.includes('rate limit')
        };
    });

    // Report findings
    if (blockingStatus.hasCaptcha) {
        console.log('  ⚠️ CAPTCHA challenge detected!');
    }
    if (blockingStatus.hasRecaptcha) {
        console.log('  ⚠️ reCAPTCHA widget found!');
    }
    if (blockingStatus.hasHcaptcha) {
        console.log('  ⚠️ hCaptcha widget found!');
    }
    if (blockingStatus.hasCloudflare) {
        console.log('  ⚠️ Cloudflare challenge detected!');
    }
    if (blockingStatus.hasAccessDenied) {
        console.log('  ⚠️ Access denied message detected!');
    }
    if (blockingStatus.hasSessionExpired) {
        console.log('  ⚠️ Session expired - cookies need refresh!');
    }
    if (blockingStatus.hasRateLimit) {
        console.log('  ⚠️ Rate limit detected - slow down requests!');
    }

    const isBlocked = Object.values(blockingStatus).some(v => v);

    if (!isBlocked) {
        console.log(`  ✅ No blocking detected on ${pageName}`);
    }

    return blockingStatus;
}

// ============================================
// MAIN COOKIE REFRESHER
// ============================================

await Actor.main(async () => {
    const input = await Actor.getInput();

    const {
        manheimCookies = [],
        credentials = null,
        twoFactorWebhookUrl = 'https://n8nsaved-production.up.railway.app/webhook/mmr2facode',
        cookieWebhookUrl = 'https://n8nsaved-production.up.railway.app/webhook/mmrcookies',
        staticProxyUrl = null, // e.g. "http://user:pass@proxy.example.com:port" for a sticky residential proxy
        proxyConfiguration = {
            useApifyProxy: false
        }
    } = input;

    console.log('🍪 Starting Manheim Cookie Refresher (with Persistent Browser)...');
    console.log(`📤 Cookie Webhook URL: ${cookieWebhookUrl}`);
    console.log(`🔐 2FA Webhook URL: ${twoFactorWebhookUrl}`);
    console.log(`👤 Credentials provided: ${credentials ? 'Yes' : 'No'}`);

    // Validate inputs
    if (!cookieWebhookUrl) {
        throw new Error('❌ cookieWebhookUrl is required! Please provide your webhook URL for cookie delivery.');
    }

    // Cookies are optional now (can login with credentials)
    if ((!manheimCookies || manheimCookies.length === 0) && !credentials) {
        throw new Error('❌ Either manheimCookies OR credentials is required!');
    }

    if (manheimCookies && manheimCookies.length > 0) {
        console.log(`\n🍪 Input cookies: ${manheimCookies.length} cookies loaded`);

        // Log cookie details
        const cookiesByDomain = {};
        manheimCookies.forEach(cookie => {
            if (!cookiesByDomain[cookie.domain]) {
                cookiesByDomain[cookie.domain] = [];
            }
            cookiesByDomain[cookie.domain].push(cookie.name);
        });

        Object.entries(cookiesByDomain).forEach(([domain, names]) => {
            console.log(`  → ${domain}: ${names.join(', ')}`);
        });
    } else {
        console.log('\n⚠️ No cookies provided - will use credential login');
    }

    // Setup proxy configuration
    let proxyUrl = null;
    if (staticProxyUrl) {
        // Static/sticky residential proxy — same IP every run (RECOMMENDED)
        proxyUrl = staticProxyUrl;
        console.log('\n🌍 Proxy Configuration (Static):');
        console.log(`  ✅ Static proxy: ${staticProxyUrl.replace(/:[^:@]+@/, ':***@')}`); // hide password
    } else if (proxyConfiguration && proxyConfiguration.useApifyProxy) {
        const proxyConfig = await Actor.createProxyConfiguration({
            ...proxyConfiguration,
            // If no session ID provided, use a fixed one for IP stickiness
            ...(proxyConfiguration.apifyProxySessionId ? {} : { apifyProxySessionId: 'manheim-sticky-1' })
        });
        proxyUrl = await proxyConfig.newUrl();

        const sessionId = proxyConfiguration.apifyProxySessionId || 'manheim-sticky-1';
        console.log('\n🌍 Proxy Configuration (Apify):');
        console.log(`  ✅ Country: ${proxyConfiguration.apifyProxyCountry || 'auto'}`);
        console.log(`  ✅ Groups: ${(proxyConfiguration.apifyProxyGroups || []).join(', ') || 'auto'}`);
        console.log(`  ✅ Session ID: ${sessionId} (sticky IP)`);
        console.log(`  ✅ Proxy URL: ${proxyUrl.substring(0, 50)}...`);
    } else {
        console.log('\n🌍 No proxy - using direct connection');
        console.log('  ⚠️ WARNING: Datacenter IP changes every run — may trigger 2FA. Consider using Apify residential proxy.');
    }

    // Load stable browser fingerprint (consistent across all runs)
    const fingerprint = await getStableFingerprint();

    // Restore browser profile from KV store (if available from previous run)
    const profileRestored = await restoreBrowserProfile();

    // Launch PERSISTENT browser context (preserves cookies/storage between runs)
    console.log('\n🌐 Launching persistent browser context...');
    console.log(`  → Profile: ${PROFILE_DIR} (${profileRestored ? 'restored from KV store' : 'fresh'})`);

    const contextOptions = {
        viewport: fingerprint.viewport,
        screen: fingerprint.screen,
        userAgent: fingerprint.userAgent,
        locale: fingerprint.locale,
        timezoneId: fingerprint.timezoneId,
        deviceScaleFactor: fingerprint.deviceScaleFactor,
        args: [
            '--disable-blink-features=AutomationControlled',
            '--disable-features=IsolateOrigins,site-per-process',
            '--disable-web-security',
            `--window-size=${fingerprint.screen.width},${fingerprint.screen.height}`,
            '--lang=en-CA',
        ],
    };

    // Only add proxy if configured
    if (proxyUrl) {
        contextOptions.proxy = { server: proxyUrl };
    }

    const context = await chromium.launchPersistentContext(PROFILE_DIR, contextOptions);

    // Set default navigation timeout
    context.setDefaultNavigationTimeout(90000);

    console.log('  ✅ Persistent browser context ready');

    // Check if profile already has cookies
    const existingCookies = await context.cookies();
    const hasExistingCookies = existingCookies.some(c =>
        c.name === '_cl' || c.name === 'SESSION'
    );

    if (hasExistingCookies) {
        console.log(`\n🍪 Found ${existingCookies.length} existing cookies in browser profile`);
    }

    // Inject cookies: input cookies > KV store cookies > profile cookies > credential login
    let hasCookiesInjected = false;

    if (manheimCookies && manheimCookies.length > 0) {
        console.log('\n🍪 Injecting fresh cookies from input...');
        await context.addCookies(manheimCookies);
        console.log(`  ✅ Injected ${manheimCookies.length} cookies from input`);
        hasCookiesInjected = true;
    } else {
        // Try to restore cookies from KV store (saved from last successful run)
        const savedCookies = await restoreSavedCookies();
        if (savedCookies && savedCookies.length > 0) {
            console.log('\n🍪 Injecting saved cookies from KV store (last successful run)...');
            await context.addCookies(savedCookies);
            console.log(`  ✅ Injected ${savedCookies.length} cookies from KV store`);
            hasCookiesInjected = true;
        } else if (!hasExistingCookies && !credentials) {
            throw new Error('❌ No cookies (input/KV store/profile) and no credentials - cannot proceed');
        } else if (!hasExistingCookies) {
            console.log('\n⚠️ No cookies anywhere - will use credential login');
        } else {
            console.log('\n✅ Using existing cookies from browser profile');
            hasCookiesInjected = true;
        }
    }

    const page = context.pages()[0] || await context.newPage();

    try {
        // STEP 1: Authenticate (cookies warm-up OR credential login)
        console.log('\n🌐 STEP 1: Checking authentication status...');

        const hasCredentials = credentials && credentials.username && credentials.password;

        if (hasCookiesInjected) {
            // Verify cookies are actually in the browser after injection
            const verifyUrls = ['https://mmr.manheim.com', 'https://mcom-header-footer.manheim.com'];
            const verifyCookies = await context.cookies(verifyUrls);
            const verifyEssential = verifyCookies.filter(c =>
                ['_cl', 'SESSION', 'session', 'session.sig'].includes(c.name)
            );
            console.log(`\n🔍 Cookie verification after injection:`);
            console.log(`  → Total cookies in browser: ${verifyCookies.length}`);
            console.log(`  → Essential cookies found: ${verifyEssential.length}/4`);
            verifyEssential.forEach(c => {
                console.log(`     • ${c.name.padEnd(15)} → ${c.domain.padEnd(35)} expires: ${c.expires === -1 ? 'session' : new Date(c.expires * 1000).toISOString()}`);
            });

            // COOKIES PATH: Test if injected cookies are still valid by navigating to MMR
            console.log('\n  → Testing injected cookies by navigating to mmr.manheim.com...');
            await page.goto('https://mmr.manheim.com/', {
                waitUntil: 'domcontentloaded',
                timeout: 90000
            });
            await humanDelay(3000, 5000);

            const testHostname = getHostname(page.url());
            console.log(`  → Landed on: ${testHostname} (${page.url().substring(0, 80)}...)`);

            if (testHostname === 'mmr.manheim.com') {
                // Cookies are valid! Session is still active
                console.log('  ✅ Cookies are VALID - session still active, no login needed!');
            } else if (testHostname === 'auth.manheim.com') {
                // Cookies expired - need to login
                console.log('  ⚠️ Cookies EXPIRED - redirected to auth page');

                if (!hasCredentials) {
                    const screenshot = await page.screenshot({ fullPage: false });
                    await Actor.setValue('login-required-screenshot', screenshot, { contentType: 'image/png' });
                    throw new Error('Session expired and credentials not provided - cannot proceed');
                }

                console.log('  → Falling back to credential login...');
                await handleLoginFlow(page, credentials, twoFactorWebhookUrl);

                // Wait for redirect back from auth
                console.log('  → Waiting for redirect after login...');
                await page.waitForURL(url => getHostname(url.toString()) !== 'auth.manheim.com', {
                    timeout: 30000
                }).catch(() => {});
                await humanDelay(3000, 5000);
                const postLoginHost = getHostname(page.url());
                console.log(`  → Post-login hostname: ${postLoginHost}`);
            } else {
                // Unexpected page - check for CAPTCHA
                console.log(`  ⚠️ Unexpected page: ${testHostname}`);
                const blocking = await detectCaptchaOrBlocking(page, 'cookie test');
                if (blocking.hasCaptcha || blocking.hasRecaptcha || blocking.hasCloudflare) {
                    const screenshot = await page.screenshot({ fullPage: false });
                    await Actor.setValue('captcha-detected-screenshot', screenshot, { contentType: 'image/png' });
                    throw new Error('CAPTCHA challenge detected - cannot proceed automatically');
                }
            }
        } else if (hasCredentials) {
            // CREDENTIALS PATH: Navigate to MMR tool to trigger OAuth redirect
            console.log('  → No cookies provided. Navigating to MMR tool to trigger auth flow...');
            await page.goto('https://mmr.manheim.com/', {
                waitUntil: 'domcontentloaded',
                timeout: 90000
            });
            await humanDelay(4000, 6000);

            const landedHostname = getHostname(page.url());
            console.log(`  → Landed on: ${landedHostname} (${page.url().substring(0, 80)}...)`);

            if (landedHostname === 'auth.manheim.com') {
                // Got redirected to login page - this is expected
                console.log('  → Auth page detected. Running login flow...');
                await handleLoginFlow(page, credentials, twoFactorWebhookUrl);

                // After login, wait for redirect back to MMR
                console.log('  → Waiting for redirect after login...');
                await page.waitForURL(url => getHostname(url.toString()) !== 'auth.manheim.com', {
                    timeout: 30000
                }).catch(() => {});
                await humanDelay(3000, 5000);

                const postLoginHostname = getHostname(page.url());
                console.log(`  → Post-login hostname: ${postLoginHostname}`);
                if (postLoginHostname === 'auth.manheim.com') {
                    const screenshot = await page.screenshot({ fullPage: false });
                    await Actor.setValue('login-failed-screenshot', screenshot, { contentType: 'image/png' });
                    throw new Error('Still on auth page after login - authentication may have failed');
                }
                console.log('  ✅ Login successful!');
            } else if (landedHostname === 'mmr.manheim.com') {
                console.log('  ✅ Already authenticated (browser profile has valid session)');
            } else {
                console.log(`  ⚠️ Unexpected hostname: ${landedHostname}`);
            }
        } else {
            throw new Error('No cookies and no credentials provided - cannot proceed');
        }

        console.log('✅ STEP 1 complete - authentication handled');

        // STEP 2: Visit www.manheim.com to trigger mcom-header-footer iframe cookies
        // This is the KEY step for getting session + session.sig cookies
        console.log('\n🌐 STEP 2: Visiting www.manheim.com to trigger iframe cookies...');
        console.log('  → The mcom-header-footer iframe sets session + session.sig cookies');
        await page.goto('https://www.manheim.com/', {
            waitUntil: 'domcontentloaded',
            timeout: 90000
        });
        console.log('  ✅ Page loaded');

        // Wait for full page load including iframes
        await humanDelay(3000, 5000);

        // Actively wait for the mcom-header-footer iframe to appear
        console.log('  → Looking for mcom-header-footer iframe...');
        let headerFooterFrameFound = false;
        try {
            await page.waitForSelector('iframe[src*="mcom-header-footer"]', { timeout: 15000 });
            headerFooterFrameFound = true;
            console.log('  ✅ mcom-header-footer iframe found in DOM');

            // Also check via frames() API for the actual frame context
            const frames = page.frames();
            const mcomFrame = frames.find(f => f.url().includes('mcom-header-footer'));
            if (mcomFrame) {
                console.log(`  ✅ Frame loaded: ${mcomFrame.url().substring(0, 80)}...`);
                // Wait for the frame to fully load (this is when cookies get set)
                await mcomFrame.waitForLoadState('domcontentloaded').catch(() => {});
                console.log('  ✅ mcom-header-footer frame fully loaded');
            }

            // Give the server time to set cookies after iframe loads
            await humanDelay(3000, 5000);
        } catch {
            console.log('  ⚠️ mcom-header-footer iframe not found (may not be available yet)');
        }

        // Simulate human activity
        console.log('  → Simulating human activity...');
        await simulateHumanMouse(page);
        await humanDelay(1000, 2000);
        await simulateHumanScroll(page);
        await humanDelay(1000, 2000);
        await simulateHumanMouse(page);
        await humanDelay(1000, 2000);

        console.log('✅ STEP 2 complete');

        // STEP 3: Access MMR tool to ensure full cookie refresh
        console.log('\n📊 STEP 3: Accessing MMR tool to refresh cookies...');
        console.log('  → Simulating mouse movement...');
        await simulateHumanMouse(page);
        await humanDelay(1000, 2000);

        let mmrPage = null;

        // Try clicking button first (human-like behavior)
        try {
            console.log('  → Checking for iframes...');
            const frames = page.frames();
            console.log(`  → Found ${frames.length} frames`);

            // Look for header iframe
            let headerFrame = null;
            for (const frame of frames) {
                const url = frame.url();
                console.log(`  → Frame URL: ${url}`);
                if (url.includes('mcom-header-footer')) {
                    headerFrame = frame;
                    console.log('  ✅ Found header/footer iframe!');
                    break;
                }
            }

            // Decide where to click based on iframe detection
            let clickTarget;
            if (headerFrame) {
                console.log('  → Attempting to click MMR button inside iframe...');
                clickTarget = headerFrame.locator('[data-test-id="mmr-btn"]').first();
            } else {
                console.log('  → Attempting to click MMR button on main page...');
                clickTarget = page.locator('[data-test-id="mmr-btn"]').first();
            }

            // Wait for button to be visible
            await clickTarget.waitFor({ state: 'visible', timeout: 10000 });
            console.log('  ✅ MMR button is visible');

            // Set up BOTH popup AND navigation listeners (race condition)
            // Use hostname check to avoid false matches on redirect_uri query params
            const popupPromise = context.waitForEvent('page', {
                predicate: (p) => getHostname(p.url()) === 'mmr.manheim.com',
                timeout: 10000
            }).catch(() => null);

            const navigationPromise = page.waitForURL(
                (url) => getHostname(url.toString()) === 'mmr.manheim.com',
                { waitUntil: 'domcontentloaded', timeout: 10000 }
            ).catch(() => null);

            // Click button with hover first (more human-like)
            await clickTarget.hover();
            await humanDelay(300, 600);
            await clickTarget.click({ timeout: 10000 });
            console.log('  ✅ MMR button clicked');

            // Wait for EITHER popup OR same-tab navigation
            console.log('  → Waiting for MMR tool to open (popup or navigation)...');
            const result = await Promise.race([popupPromise, navigationPromise]);

            // Check if we got a new popup page (has url() method) or same-tab navigation
            if (result && typeof result.url === 'function') {
                // New popup opened
                mmrPage = result;
                console.log(`  ✅ Popup opened successfully: ${mmrPage.url()}`);
            } else {
                // Same-tab navigation occurred (or both timed out, but page might have navigated)
                mmrPage = page;
                console.log(`  ✅ Navigated in same tab: ${mmrPage.url()}`);
            }

        } catch (error) {
            console.log(`  ⚠️ Button/popup approach failed: ${error.message}`);
            console.log('  → Fallback: Opening MMR tool directly...');

            // Fallback: Navigate directly to MMR tool
            mmrPage = await context.newPage();
            await mmrPage.goto('https://mmr.manheim.com/ui-mmr/?country=US&popup=true&source=man', {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });
            console.log('  ✅ MMR tool loaded via direct navigation');
        }

        // Verify we have MMR page
        if (!mmrPage) {
            console.error('\n❌ Failed to open MMR tool!');
            const screenshot = await page.screenshot({ fullPage: false });
            await Actor.setValue('mmr-failed-screenshot', screenshot, { contentType: 'image/png' });
            throw new Error('Could not access MMR tool - both button click and direct navigation failed');
        }

        console.log(`✅ MMR page ready: ${mmrPage.url()}`);

        // Wait for page to fully load
        console.log('  → Waiting for page to load...');
        await mmrPage.waitForLoadState('domcontentloaded');
        await humanDelay(3000, 5000);

        console.log('✅ MMR tool loaded successfully');

        // Check if we're already on MMR tool (auto-redirect happened)
        let currentUrl = mmrPage.url();
        console.log(`  → Current URL: ${currentUrl}`);

        const currentHostname = getHostname(currentUrl);
        if (currentHostname === 'mmr.manheim.com') {
            console.log('  ✅ Already on MMR tool - cookies are valid, no login needed!');
        } else if (currentHostname === 'auth.manheim.com') {
            // We're on auth page - wait a bit for potential auto-redirect
            console.log('  → On auth page, waiting for potential auto-redirect...');
            await humanDelay(3000, 5000);

            // Check URL again after waiting
            currentUrl = mmrPage.url();
            const updatedHostname = getHostname(currentUrl);
            console.log(`  → URL after waiting: ${currentUrl}`);

            if (updatedHostname === 'mmr.manheim.com') {
                console.log('  ✅ Auto-redirected to MMR tool - cookies are valid!');
            } else {
                // Still on auth page - check if login form is displayed
                console.log('  → Still on auth page, checking if login is required...');
                const isMMRLoginPage = await detectLoginPage(mmrPage);

                if (isMMRLoginPage) {
                    console.log('  ⚠️ Login page detected in MMR popup - need to authenticate');

                    // Check if we have credentials
                    if (!credentials || !credentials.username || !credentials.password) {
                        throw new Error('Login required but no credentials provided');
                    }

                    // Perform login flow
                    await handleLoginFlow(mmrPage, credentials, twoFactorWebhookUrl);

                    // After login, wait for redirect to MMR tool
                    console.log('  → Waiting for redirect to MMR tool after login...');
                    await humanDelay(3000, 5000);

                    // Check if we're now on MMR tool
                    const urlAfterLogin = mmrPage.url();
                    console.log(`  → Current URL after login: ${urlAfterLogin}`);

                    if (getHostname(urlAfterLogin) === 'auth.manheim.com') {
                        throw new Error('Still on auth page after login - authentication may have failed');
                    }
                } else {
                    console.log('  ✅ No login form detected - session may be valid');
                }
            }
        }

        // Now check for CAPTCHA (after login check)
        console.log('  → Checking for CAPTCHA on MMR page...');
        const mmrBlocking = await detectCaptchaOrBlocking(mmrPage, 'MMR tool');
        if (mmrBlocking.hasCaptcha || mmrBlocking.hasRecaptcha || mmrBlocking.hasHcaptcha || mmrBlocking.hasCloudflare) {
            console.error('\n❌ CAPTCHA or challenge detected on MMR page!');
            const screenshot = await mmrPage.screenshot({ fullPage: false });
            await Actor.setValue('mmr-captcha-screenshot', screenshot, { contentType: 'image/png' });
            throw new Error('CAPTCHA on MMR tool - cannot proceed automatically');
        }
        console.log('  ✅ No CAPTCHA detected');

        // STEP 4: More human activity on MMR page
        console.log('\n🖱️ STEP 4: Simulating human activity on MMR page...');
        console.log('  → Mouse movement...');
        await simulateHumanMouse(mmrPage);
        await humanDelay(1500, 2500);

        console.log('  → Scrolling...');
        await simulateHumanScroll(mmrPage);
        await humanDelay(1500, 2500);

        console.log('  → Final mouse movement...');
        await simulateHumanMouse(mmrPage);
        await humanDelay(1000, 2000);

        console.log('✅ Human activity completed on MMR page');

        // STEP 4.5: Click VIN input to trigger JS events
        console.log('\n🔘 STEP 4.5: Clicking VIN input field...');
        try {
            await mmrPage.click('#vinText', { timeout: 5000 });
            console.log('  ✅ VIN input field clicked');
            await humanDelay(1000, 2000);
        } catch (error) {
            console.log(`  ⚠️ Could not click VIN input: ${error.message}`);
            console.log('  → Continuing without button click...');
        }

        // OPTION 1: Close popup and navigate to MMR on main page
        console.log('\n🔄 STEP 5: Closing popup and opening MMR on main page...');
        console.log('  → This ensures full page load with all components (header/footer)');

        // Close the popup
        console.log('  → Closing MMR popup...');
        await mmrPage.close();
        console.log('  ✅ Popup closed');

        // Wait a bit for cookies to sync
        await humanDelay(2000, 3000);

        // Now navigate to MMR tool on the MAIN page (not popup)
        console.log('  → Navigating to MMR tool on main page...');
        console.log('  → URL: https://mmr.manheim.com/?country=US&source=man');
        await page.goto('https://mmr.manheim.com/?country=US&source=man', {
            waitUntil: 'domcontentloaded',
            timeout: 90000
        });
        console.log('  ✅ MMR tool loaded on main page');

        // Wait for page to fully load with all components
        console.log('  → Waiting for full page load (including header/footer)...');
        await humanDelay(5000, 7000);

        // Check if we're on MMR tool or got redirected
        const finalUrl = page.url();
        console.log(`  → Current URL: ${finalUrl}`);

        if (getHostname(finalUrl) !== 'mmr.manheim.com') {
            console.log('  ⚠️ Not on MMR page - may have been redirected');
        } else {
            console.log('  ✅ On MMR tool page');
        }

        // Simulate human activity on full page
        console.log('  → Simulating human activity...');
        await simulateHumanMouse(page);
        await humanDelay(2000, 3000);
        await simulateHumanScroll(page);
        await humanDelay(2000, 3000);

        // Click VIN input on main page
        console.log('  → Clicking VIN input on main page...');
        try {
            await page.click('#vinText', { timeout: 5000 });
            console.log('  ✅ VIN input clicked');
            await humanDelay(1000, 2000);
        } catch (error) {
            console.log(`  ⚠️ Could not click VIN input: ${error.message}`);
        }

        // Return to www.manheim.com (NOT site.manheim.com which is public/no iframe)
        console.log('  → Returning to www.manheim.com (has mcom-header-footer iframe)...');
        await page.goto('https://www.manheim.com/', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
        console.log('  ✅ Back on www.manheim.com');

        console.log('  → Waiting for cookies to settle...');
        await humanDelay(3000, 5000);

        // STEP 5.5: Check if cookies changed, if not perform max 3 hard refreshes
        console.log('\n🔄 STEP 5.5: Checking if cookies changed...');

        // Helper function to check if cookies changed
        const checkCookiesChanged = (currentCookies, inputCookies) => {
            // If no input cookies were provided (credential-only login),
            // consider "changed" = we now have essential auth cookies
            if (!inputCookies || inputCookies.length === 0) {
                const hasCL = currentCookies.some(c => c.name === '_cl' && c.domain.includes('manheim'));
                const hasSESSION = currentCookies.some(c => c.name === 'SESSION' && c.domain.includes('manheim'));
                return hasCL && hasSESSION;
            }

            const inputCL = inputCookies.find(c => c.name === '_cl')?.value;
            const inputSESSION = inputCookies.find(c => c.name === 'SESSION')?.value;
            const inputSig = inputCookies.find(c => c.name === 'session.sig')?.value;

            const currentCL = currentCookies.find(c => c.name === '_cl' && c.domain.includes('manheim'))?.value;
            const currentSESSION = currentCookies.find(c => c.name === 'SESSION' && c.domain.includes('manheim'))?.value;
            const currentSig = currentCookies.find(c => c.name === 'session.sig' && c.domain.includes('manheim'))?.value;

            return (
                currentCL !== inputCL ||
                currentSESSION !== inputSESSION ||
                currentSig !== inputSig
            );
        };

        let attempts = 0;
        const maxAttempts = 3;
        let cookiesChanged = false;

        // Initial check
        let currentCookies = await context.cookies();
        cookiesChanged = checkCookiesChanged(currentCookies, manheimCookies);

        if (cookiesChanged) {
            console.log('  ✅ Cookies have changed! Fresh cookies detected.');
        } else {
            console.log('  ⚠️ Cookies unchanged, performing hard refreshes...');

            while (attempts < maxAttempts && !cookiesChanged) {
                attempts++;
                console.log(`  → Attempt ${attempts}/${maxAttempts}: Performing hard refresh...`);

                await page.reload({ waitUntil: 'domcontentloaded' });
                await humanDelay(3000, 5000);

                currentCookies = await context.cookies();
                cookiesChanged = checkCookiesChanged(currentCookies, manheimCookies);

                if (cookiesChanged) {
                    console.log(`  ✅ Cookies changed after ${attempts} refresh(es)!`);
                    break;
                }
            }

            if (!cookiesChanged) {
                console.log(`  ⚠️ Warning: Cookies did not change after ${maxAttempts} refreshes`);
                console.log('  → Sending current cookies anyway (they may still be valid)');
            }
        }

        // More human activity on homepage
        console.log('  → Simulating human activity on homepage...');
        await simulateHumanMouse(page);
        await humanDelay(1000, 2000);

        await simulateHumanScroll(page);
        await humanDelay(1000, 2000);

        await simulateHumanMouse(page);
        await humanDelay(1000, 2000);

        console.log('✅ Back on Manheim homepage - cookies should be fully refreshed');

        // STEP 6: Extract fresh cookies from browser context
        console.log('\n🍪 STEP 6: Extracting fresh cookies...');

        const allCookies = await context.cookies();
        console.log(`  → Total cookies in browser: ${allCookies.length}`);

        // Debug: Show all manheim cookies with their domains
        console.log('\n  📋 All Manheim cookies found:');
        const manheimCookiesDebug = allCookies.filter(c => c.domain.includes('manheim'));
        manheimCookiesDebug.forEach(c => {
            console.log(`     • ${c.name.padEnd(20)} → ${c.domain}`);
        });
        console.log('');

        // Filter for the 4 essential cookies
        const essentialCookies = {
            '_cl': null,
            'SESSION': null,
            'session': null,
            'session.sig': null
        };

        // Extract matching cookies (accept from any manheim domain)
        allCookies.forEach(cookie => {
            if (essentialCookies.hasOwnProperty(cookie.name) && !essentialCookies[cookie.name]) {
                // Accept cookie from any manheim domain
                if (cookie.domain.includes('manheim')) {
                    essentialCookies[cookie.name] = cookie;
                    console.log(`  ✅ Found: ${cookie.name} (${cookie.domain})`);
                }
            }
        });

        // Verify required cookies were found (_cl and SESSION are critical)
        const missingRequired = [];
        const missingOptional = [];

        if (!essentialCookies['_cl']) {
            missingRequired.push('_cl');
            console.log(`  ❌ Missing (REQUIRED): _cl`);
        }
        if (!essentialCookies['SESSION']) {
            missingRequired.push('SESSION');
            console.log(`  ❌ Missing (REQUIRED): SESSION`);
        }

        if (!essentialCookies['session']) {
            missingOptional.push('session');
            console.log(`  ⚠️ Missing: session`);
        }
        if (!essentialCookies['session.sig']) {
            missingOptional.push('session.sig');
            console.log(`  ⚠️ Missing: session.sig`);
        }

        if (missingRequired.length > 0) {
            console.error(`\n❌ Failed to extract required cookies. Missing: ${missingRequired.join(', ')}`);
            await Actor.setValue('all-cookies-debug', allCookies);
            throw new Error(`Missing required cookies: ${missingRequired.join(', ')}`);
        }

        // Try to get session/session.sig from mcom-header-footer iframe
        let isPartial = false;
        if (missingOptional.length > 0) {
            console.log(`\n⚠️ Optional cookies missing: ${missingOptional.join(', ')}`);
            console.log('🔄 Fallback: Reloading www.manheim.com to trigger mcom-header-footer iframe...');

            try {
                // Fresh navigation to www.manheim.com with networkidle (wait for all requests)
                await page.goto('https://www.manheim.com/', {
                    waitUntil: 'networkidle',
                    timeout: 30000
                });
                console.log('  ✅ Homepage loaded (networkidle)');

                // Wait for iframe in DOM
                console.log('  → Waiting for mcom-header-footer iframe...');
                try {
                    await page.waitForSelector('iframe[src*="mcom-header-footer"]', { timeout: 15000 });
                    console.log('  ✅ Found mcom-header-footer iframe in DOM');
                } catch {
                    console.log('  ⚠️ mcom-header-footer iframe not found in DOM');
                }

                // Also check via frames() API and wait for frame to load
                const fallbackFrames = page.frames();
                const mcomFallbackFrame = fallbackFrames.find(f => f.url().includes('mcom-header-footer'));
                if (mcomFallbackFrame) {
                    console.log(`  ✅ Found mcom-header-footer frame context: ${mcomFallbackFrame.url().substring(0, 80)}...`);
                    await mcomFallbackFrame.waitForLoadState('domcontentloaded').catch(() => {});
                    console.log('  ✅ Frame fully loaded - cookies should be set');
                    await humanDelay(3000, 5000);
                } else {
                    console.log('  ⚠️ mcom-header-footer frame not found in frames() - listing available frames:');
                    fallbackFrames.forEach(f => console.log(`     • ${f.url().substring(0, 100)}`));
                }

                // Retry loop: poll for cookies up to 3 times
                for (let retry = 0; retry < 3 && missingOptional.length > 0; retry++) {
                    console.log(`  → Cookie check attempt ${retry + 1}/3...`);
                    await humanDelay(2000, 3000);

                    const retryCookies = await context.cookies();
                    retryCookies.forEach(cookie => {
                        if ((cookie.name === 'session' || cookie.name === 'session.sig') &&
                            cookie.domain.includes('manheim') &&
                            !essentialCookies[cookie.name]) {
                            essentialCookies[cookie.name] = cookie;
                            console.log(`  ✅ Found on attempt ${retry + 1}: ${cookie.name} (${cookie.domain})`);
                            const index = missingOptional.indexOf(cookie.name);
                            if (index > -1) missingOptional.splice(index, 1);
                        }
                    });
                }
            } catch (error) {
                console.log(`  ⚠️ Fallback navigation failed: ${error.message}`);
            }

            // If STILL missing, mark as partial but DO NOT fail
            if (missingOptional.length > 0) {
                console.log(`  ⚠️ Still missing after retries: ${missingOptional.join(', ')}`);
                console.log('  → Will send partial cookie set with warning flag');
                isPartial = true;
                await Actor.setValue('all-cookies-debug', await context.cookies());
            } else {
                console.log('  ✅ All optional cookies found after fallback!');
            }
        }

        console.log(`\n✅ Essential cookies extracted: ${isPartial ? '2/4 (PARTIAL)' : '4/4'}`);

        // Save ALL manheim cookies to KV store for next run
        // (includes auth trust cookies like PF.PERSISTENT, pingone.risk.browser.profile
        //  which help skip 2FA on re-login)
        const allManheimCookies = allCookies.filter(c => c.domain.includes('manheim'));
        console.log(`  → Saving ${allManheimCookies.length} manheim cookies to KV store (includes auth trust cookies)`);
        await saveCookiesToKV(allManheimCookies);

        // STEP 7: Prepare webhook payload
        console.log('\n📤 STEP 7: Preparing webhook payload...');

        // Only include cookies that were found
        const cookieArray = [
            essentialCookies['_cl'],
            essentialCookies['SESSION'],
            essentialCookies['session'],
            essentialCookies['session.sig']
        ].filter(c => c !== null);

        const webhookPayload = {
            success: true,
            partial: isPartial,
            missingCookies: isPartial ? missingOptional : undefined,
            timestamp: new Date().toISOString(),
            cookies: cookieArray,
            cookieDetails: {
                _cl: {
                    found: !!essentialCookies['_cl'],
                    domain: essentialCookies['_cl']?.domain,
                    expires: essentialCookies['_cl']?.expires || 'session'
                },
                SESSION: {
                    found: !!essentialCookies['SESSION'],
                    domain: essentialCookies['SESSION']?.domain,
                    expires: essentialCookies['SESSION']?.expires || 'session'
                },
                session: {
                    found: !!essentialCookies['session'],
                    domain: essentialCookies['session']?.domain || 'mcom-header-footer.manheim.com',
                    expires: essentialCookies['session']?.expires || 'session'
                },
                'session.sig': {
                    found: !!essentialCookies['session.sig'],
                    domain: essentialCookies['session.sig']?.domain || 'mcom-header-footer.manheim.com',
                    expires: essentialCookies['session.sig']?.expires || 'session'
                }
            }
        };

        console.log('  → Payload prepared');
        console.log(`  → Cookie count: ${cookieArray.length}/4${isPartial ? ' (PARTIAL)' : ''}`);
        console.log('  → Timestamp:', webhookPayload.timestamp);

        // STEP 8: Send to webhook
        console.log('\n📤 STEP 8: Sending cookies to webhook...');
        console.log(`  → URL: ${cookieWebhookUrl}`);

        const webhookResponse = await fetch(cookieWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(webhookPayload)
        });

        if (webhookResponse.ok) {
            console.log(`  ✅ Webhook sent successfully (${webhookResponse.status})`);
            const responseText = await webhookResponse.text();
            if (responseText) {
                console.log(`  → Response: ${responseText}`);
            }
        } else {
            console.log(`  ⚠️ Webhook failed (${webhookResponse.status})`);
            const errorText = await webhookResponse.text();
            console.log(`  → Error: ${errorText}`);
            throw new Error(`Webhook failed with status ${webhookResponse.status}`);
        }

        // STEP 9: Save cookies to Apify KV store as backup
        console.log('\n💾 STEP 9: Saving cookies to Apify KV store (backup)...');
        await Actor.setValue('fresh-cookies', webhookPayload);
        console.log('  ✅ Cookies saved to key-value store');

        // STEP 10: Summary
        console.log('\n' + '='.repeat(60));
        console.log('✅ COOKIE REFRESH COMPLETED SUCCESSFULLY');
        console.log('='.repeat(60));
        console.log('📊 Summary:');
        console.log(`  • Cookies extracted: ${cookieArray.length}/4${isPartial ? ' (PARTIAL)' : ''}`);
        console.log('  • Webhook delivery: ✅ Success');
        console.log('  • Backup saved: ✅ Yes');
        console.log('  • Timestamp:', webhookPayload.timestamp);
        console.log('='.repeat(60) + '\n');

    } catch (error) {
        console.error('\n❌ Fatal error:', error.message);

        // Send failure notification to webhook
        try {
            const failurePayload = {
                success: false,
                timestamp: new Date().toISOString(),
                error: error.message,
                cookies: null
            };

            await fetch(cookieWebhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(failurePayload)
            });

            console.log('  → Failure notification sent to webhook');
        } catch (webhookError) {
            console.error('  → Failed to send failure notification:', webhookError.message);
        }

        throw error;
    } finally {
        // Close browser FIRST so profile files are flushed to disk
        await context.close();

        // Small delay to ensure all profile files are fully written
        await new Promise(r => setTimeout(r, 2000));

        // Save browser profile to KV store for next run
        await saveBrowserProfile();

        console.log('🍪 Cookie refresher completed! Browser profile persisted to KV store.');
    }
});
