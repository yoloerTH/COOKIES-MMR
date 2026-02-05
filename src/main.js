import { Actor } from 'apify';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

// Add stealth plugin
chromium.use(StealthPlugin());

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

        // Try clicking the label (works for custom-styled checkboxes)
        const labelSelectors = [
            'label.remember-username',
            'label:has-text("Remember my username")',
            '.ping-checkbox-container:has-text("Remember my username")'
        ];

        let clicked = false;
        for (const selector of labelSelectors) {
            try {
                const label = page.locator(selector).first();
                const count = await label.count();
                if (count > 0) {
                    await label.click({ timeout: 3000 });
                    console.log(`  ✅ Remember username checked (clicked ${selector})`);
                    clicked = true;
                    break;
                }
            } catch (e) {
                // Try next selector
            }
        }

        // Fallback: try checking the input directly with force
        if (!clicked) {
            const checkbox = page.locator('input#rememberUsername, input[name="pf.rememberUsername"]').first();
            await checkbox.check({ timeout: 3000, force: true });
            console.log('  ✅ Remember username checked (forced)');
        }

        await humanDelay(500, 1000);
    } catch (e) {
        console.log('  → Remember username checkbox not found or not clickable (skipping)');
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
    if (proxyConfiguration && proxyConfiguration.useApifyProxy) {
        const proxyConfig = await Actor.createProxyConfiguration(proxyConfiguration);
        proxyUrl = await proxyConfig.newUrl();

        console.log('\n🌍 Proxy Configuration:');
        console.log(`  ✅ Country: ${proxyConfiguration.apifyProxyCountry}`);
        console.log(`  ✅ Groups: ${proxyConfiguration.apifyProxyGroups.join(', ')}`);
        console.log(`  ✅ Proxy URL: ${proxyUrl.substring(0, 50)}...`);
    } else {
        console.log('\n🌍 No proxy - using direct connection');
    }

    // Launch PERSISTENT browser context (preserves cookies/storage between runs)
    console.log('\n🌐 Launching persistent browser context...');
    console.log('  → Profile: ./manheim_browser_profile');

    const contextOptions = {
        viewport: { width: 1920, height: 1080 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        locale: 'en-CA', // Canadian locale
        timezoneId: 'America/Edmonton', // Alberta, Canada timezone (Mountain Time)
        args: [
            '--disable-blink-features=AutomationControlled',
            '--disable-features=IsolateOrigins,site-per-process',
            '--disable-web-security',
        ],
    };

    // Only add proxy if configured
    if (proxyUrl) {
        contextOptions.proxy = { server: proxyUrl };
    }

    const context = await chromium.launchPersistentContext('./manheim_browser_profile', contextOptions);

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

    // Inject fresh cookies if provided (overwrites existing)
    if (manheimCookies && manheimCookies.length > 0) {
        console.log('\n🍪 Injecting fresh cookies from input...');
        await context.addCookies(manheimCookies);
        console.log(`  ✅ Injected ${manheimCookies.length} cookies (merged with profile)`);
    } else if (!hasExistingCookies && !credentials) {
        throw new Error('❌ No cookies in profile and no credentials provided - cannot proceed');
    } else if (!hasExistingCookies) {
        console.log('\n⚠️ No cookies in profile - will use credential login');
    } else {
        console.log('\n✅ Using existing cookies from browser profile');
    }

    const page = context.pages()[0] || await context.newPage();

    try {
        // STEP 1: Visit Manheim site homepage to trigger session refresh
        console.log('\n🌐 STEP 1: Visiting Manheim site homepage...');
        console.log('  → Navigating to: https://site.manheim.com/');

        await page.goto('https://site.manheim.com/', {
            waitUntil: 'domcontentloaded',
            timeout: 90000
        });
        console.log('  ✅ Page loaded (domcontentloaded)');

        console.log('  → Waiting 4-6 seconds for page to fully load...');
        await humanDelay(4000, 6000);

        // Check for CAPTCHA or blocking
        const homeBlocking = await detectCaptchaOrBlocking(page, 'Manheim home');
        if (homeBlocking.hasCaptcha || homeBlocking.hasRecaptcha || homeBlocking.hasCloudflare) {
            console.error('\n❌ CAPTCHA or challenge detected on home page!');
            const screenshot = await page.screenshot({ fullPage: false });
            await Actor.setValue('captcha-detected-screenshot', screenshot, { contentType: 'image/png' });
            throw new Error('CAPTCHA challenge detected - cannot proceed automatically');
        }

        // Check if login page appeared (cookies invalid)
        const isLoginPage = await detectLoginPage(page);
        if (isLoginPage) {
            if (!credentials || !credentials.username || !credentials.password) {
                console.error('\n❌ Login page detected but no credentials provided!');
                const screenshot = await page.screenshot({ fullPage: false });
                await Actor.setValue('login-required-screenshot', screenshot, { contentType: 'image/png' });
                throw new Error('Session expired and credentials not provided - cannot proceed');
            }

            // CREDENTIAL LOGIN FLOW
            console.log('\n🔐 LOGIN FLOW: Entering credentials...');
            console.log(`  → Username: ${credentials.username}`);

            // Fill username
            console.log('  → Filling username field...');
            await page.fill('input#username', credentials.username);
            await humanDelay(500, 1000);

            // Fill password
            console.log('  → Filling password field...');
            await page.fill('input#password', credentials.password);
            await humanDelay(500, 1000);

            // Check "Remember my username"
            console.log('  → Checking "Remember my username"...');
            await page.check('input#rememberUsername');
            await humanDelay(500, 1000);

            // Find and click submit button
            console.log('  → Clicking submit button...');
            const submitButton = await page.locator('button[type="submit"], input[type="submit"], button:has-text("Sign In"), button:has-text("Log In")').first();
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

                // Call 2FA webhook and wait for code (2.5 minute timeout)
                console.log(`  → Calling 2FA webhook: ${twoFactorWebhookUrl}`);
                console.log('  → Waiting up to 2.5 minutes for your response...');

                let twoFACode = null;
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 150000); // 2.5 minutes

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
                        twoFACode = jsonResponse.code || jsonResponse['2fa_code'] || jsonResponse.otp || jsonResponse.token;
                        console.log('  → Parsed as JSON');
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
                        throw new Error('2FA webhook timed out after 2.5 minutes - no response received');
                    }
                    throw error;
                }

                console.log(`  ✅ 2FA code received: ${twoFACode}`);

                // Enter 2FA code
                console.log('  → Entering 2FA code...');
                await page.fill(twoFAInput, twoFACode);
                console.log('  ✅ Code entered');

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

        console.log('✅ Manheim homepage loaded successfully');

        // STEP 2: Simulate human activity
        console.log('\n🖱️ STEP 2: Simulating human activity...');
        console.log('  → Mouse movement...');
        await simulateHumanMouse(page);
        await humanDelay(1000, 2000);

        console.log('  → Scrolling...');
        await simulateHumanScroll(page);
        await humanDelay(1000, 2000);

        console.log('  → More mouse movement...');
        await simulateHumanMouse(page);
        await humanDelay(1000, 2000);

        console.log('✅ Human activity simulated');

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
            const popupPromise = context.waitForEvent('page', {
                predicate: (p) => p.url().includes('mmr.manheim.com'),
                timeout: 10000
            }).catch(() => null);

            const navigationPromise = page.waitForNavigation({
                url: /mmr\.manheim\.com/,
                waitUntil: 'domcontentloaded',
                timeout: 10000
            }).catch(() => null);

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

        // Check if we landed on a login page instead of MMR tool
        console.log('  → Checking if login is required...');
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
            const currentUrl = mmrPage.url();
            console.log(`  → Current URL after login: ${currentUrl}`);

            if (currentUrl.includes('auth.manheim.com')) {
                throw new Error('Still on auth page after login - authentication may have failed');
            }
        } else {
            console.log('  ✅ Already authenticated - MMR tool is accessible');
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

        // STEP 5: Navigate back using browser back button (like manual process)
        console.log('\n🔙 STEP 5: Using browser back button to return...');
        console.log('  → This mimics the manual cookie extraction process');

        // Use browser back button (like manual process)
        await page.goBack({ waitUntil: 'domcontentloaded' });
        console.log('  ✅ Returned to previous page using back button');

        console.log('  → Waiting 3-5 seconds for cookies to settle...');
        await humanDelay(3000, 5000);

        // Visit main homepage to trigger header/footer cookies (session and session.sig)
        console.log('\n🌐 STEP 5.3: Visiting main homepage to trigger all cookies...');
        console.log('  → Navigating to https://www.manheim.com/...');
        await page.goto('https://www.manheim.com/', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
        console.log('  ✅ Homepage loaded');

        console.log('  → Waiting for header/footer to load...');
        await humanDelay(4000, 6000);

        console.log('  → Returning to site.manheim.com...');
        await page.goto('https://site.manheim.com/', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
        console.log('  ✅ Back on site page');

        console.log('  → Waiting for cookies to sync...');
        await humanDelay(3000, 5000);

        // STEP 5.5: Check if cookies changed, if not perform max 3 hard refreshes
        console.log('\n🔄 STEP 5.5: Checking if cookies changed...');

        // Helper function to check if cookies changed
        const checkCookiesChanged = (currentCookies, inputCookies) => {
            const inputCL = inputCookies.find(c => c.name === '_cl')?.value;
            const inputSESSION = inputCookies.find(c => c.name === 'SESSION')?.value;
            const inputSig = inputCookies.find(c => c.name === 'session.sig')?.value;

            const currentCL = currentCookies.find(c => c.name === '_cl' && c.domain === '.manheim.com')?.value;
            const currentSESSION = currentCookies.find(c => c.name === 'SESSION' && c.domain === '.manheim.com')?.value;
            const currentSig = currentCookies.find(c => c.name === 'session.sig' && c.domain === 'mcom-header-footer.manheim.com')?.value;

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

        // Verify all 4 cookies were found
        const missingCookies = [];
        Object.keys(essentialCookies).forEach(name => {
            if (!essentialCookies[name]) {
                missingCookies.push(name);
                console.log(`  ❌ Missing: ${name}`);
            }
        });

        if (missingCookies.length > 0) {
            console.error(`\n❌ Failed to extract all cookies. Missing: ${missingCookies.join(', ')}`);

            // Save all cookies for debugging
            await Actor.setValue('all-cookies-debug', allCookies);
            console.log('  → All cookies saved to key-value store for debugging');

            throw new Error(`Missing cookies: ${missingCookies.join(', ')}`);
        }

        console.log('\n✅ All 4 essential cookies extracted successfully!');

        // STEP 7: Prepare webhook payload
        console.log('\n📤 STEP 7: Preparing webhook payload...');

        const cookieArray = [
            essentialCookies['_cl'],
            essentialCookies['SESSION'],
            essentialCookies['session'],
            essentialCookies['session.sig']
        ];

        const webhookPayload = {
            success: true,
            timestamp: new Date().toISOString(),
            cookies: cookieArray,
            cookieDetails: {
                _cl: {
                    found: true,
                    domain: essentialCookies['_cl'].domain,
                    expires: essentialCookies['_cl'].expires || 'session'
                },
                SESSION: {
                    found: true,
                    domain: essentialCookies['SESSION'].domain,
                    expires: essentialCookies['SESSION'].expires || 'session'
                },
                session: {
                    found: true,
                    domain: essentialCookies['session'].domain,
                    expires: essentialCookies['session'].expires || 'session'
                },
                'session.sig': {
                    found: true,
                    domain: essentialCookies['session.sig'].domain,
                    expires: essentialCookies['session.sig'].expires || 'session'
                }
            }
        };

        console.log('  → Payload prepared');
        console.log('  → Cookie count: 4');
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
        console.log('  • Cookies extracted: 4/4');
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
        await context.close();
        console.log('🍪 Cookie refresher completed! Browser profile saved to ./manheim_browser_profile');
    }
});
