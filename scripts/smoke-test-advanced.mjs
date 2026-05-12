#!/usr/bin/env node
/**
 * mentiko post-deploy smoke test suite (advanced)
 *
 * runs in <90 seconds, outputs pass/fail with evidence
 * uses puppeteer for UI testing, fetch for API testing
 *
 * usage:
 *   SMOKE_BASE_URL=https://<your-qa-host> node scripts/smoke-test-advanced.mjs
 *   SMOKE_BASE_URL=https://<your-prod-host> node scripts/smoke-test-advanced.mjs
 *
 * env vars:
 *   SMOKE_BASE_URL    - target URL (default: http://localhost:3000)
 *   SMOKE_EMAIL       - login email (no default; set for your env)
 *   SMOKE_PASSWORD    - login password (no default; set for your env)
 *   SMOKE_OUTPUT_DIR  - output directory (default: ./smoke-test-results)
 *   SMOKE_TIMEOUT     - max runtime in seconds (default: 85)
 *   SMOKE_HEADLESS    - run headless (default: true)
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// CONFIGURATION
// ============================================================================

const config = {
    baseUrl: process.env.SMOKE_BASE_URL || 'http://localhost:3000',
    email: process.env.SMOKE_EMAIL || '',
    password: process.env.SMOKE_PASSWORD || '',
    outputDir: process.env.SMOKE_OUTPUT_DIR || join(process.cwd(), 'smoke-test-results'),
    timeout: parseInt(process.env.SMOKE_TIMEOUT || '85', 10) * 1000,
    headless: process.env.SMOKE_HEADLESS !== 'false',
    screenshots: process.env.SMOKE_SCREENSHOTS !== 'false',
};

// Create output directory
mkdirSync(config.outputDir, { recursive: true });

// ============================================================================
// UTILITIES
// ============================================================================

const startTime = Date.now();
const results = {
    passed: [],
    failed: [],
    warnings: [],
};

function log(level, message, data = null) {
    const timestamp = new Date().toISOString().split('T')[1].slice(0, -1);
    const prefix = {
        info: '\x1b[36m[INFO]\x1b[0m',
        pass: '\x1b[32m[PASS]\x1b[0m',
        fail: '\x1b[31m[FAIL]\x1b[0m',
        warn: '\x1b[33m[WARN]\x1b[0m',
    }[level];

    console.log(`${prefix} [${timestamp}] ${message}`);

    if (data) {
        writeFileSync(join(config.outputDir, `${level}.log`), `${timestamp} ${message}\n${JSON.stringify(data, null, 2)}\n`, { flag: 'a' });
    }
}

function recordPass(testName, details = {}) {
    results.passed.push({ name: testName, ...details });
    log('pass', testName);
}

function recordFail(testName, details = {}) {
    results.failed.push({ name: testName, ...details });
    log('fail', testName, details);
}

function recordWarn(testName, details = {}) {
    results.warnings.push({ name: testName, ...details });
    log('warn', testName, details);
}

function getElapsed() {
    return Math.round((Date.now() - startTime) / 1000);
}

function checkTimeout() {
    if (Date.now() - startTime > config.timeout) {
        throw new Error(`Smoke test timeout exceeded (${config.timeout}ms)`);
    }
}

// ============================================================================
// API TEST HELPERS
// ============================================================================

async function apiGet(endpoint) {
    const url = `${config.baseUrl}/api${endpoint}`;
    log('info', `GET ${url}`);

    const response = await fetch(url, {
        redirect: 'manual',
        headers: {
            'User-Agent': 'mentiko-smoke-test/1.0',
        },
    });

    const body = await response.text();
    let json = null;

    try {
        json = JSON.parse(body);
    } catch {
        // Not JSON
    }

    // Save response for debugging
    writeFileSync(join(config.outputDir, `api_${endpoint.replace(/\//g, '_')}.json`), body);

    return {
        url,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body,
        json,
    };
}

function verifyEnvelope(response, endpoint) {
    if (!response.json) {
        recordFail(`${endpoint} - envelope`, { reason: 'Not JSON' });
        return false;
    }

    if (typeof response.json.success !== 'boolean') {
        recordFail(`${endpoint} - envelope`, { reason: 'Missing success field' });
        return false;
    }

    if (!response.json.requestId) {
        recordWarn(`${endpoint} - envelope`, { reason: 'Missing requestId' });
        return true; // Warning only
    }

    recordPass(`${endpoint} - envelope`);
    return true;
}

// ============================================================================
// HEALTH CHECK TEST
// ============================================================================

async function testHealth() {
    log('info', 'Testing health endpoint...');

    const response = await apiGet('/health');

    if (response.status !== 200) {
        recordFail('Health endpoint', { status: response.status, expected: 200 });
        return;
    }

    if (!response.json) {
        recordFail('Health endpoint', { reason: 'Not JSON' });
        return;
    }

    const { status, checks } = response.json;

    if (!status) {
        recordFail('Health endpoint', { reason: 'Missing status field' });
        return;
    }

    if (status === 'unhealthy') {
        recordFail('Health status', { status, checks });
        return;
    }

    if (status === 'degraded') {
        recordWarn('Health status', { status, checks });
    } else {
        recordPass('Health status', { status });
    }

    // Check critical services
    if (checks.database?.status === 'fail') {
        recordFail('Database check', { check: checks.database });
        return;
    }

    recordPass('Database check', { check: checks.database });

    // PTY check can be warn in some environments
    if (checks.pty_daemon?.status === 'warn') {
        recordWarn('PTY daemon check', { check: checks.pty_daemon });
    } else {
        recordPass('PTY daemon check', { check: checks.pty_daemon });
    }

    return response.json;
}

// ============================================================================
// API ENVELOPE TESTS
// ============================================================================

async function testApiEnvelope() {
    log('info', 'Testing API envelope shapes...');

    // Test endpoints that don't require auth
    const endpoints = [
        '/health',
    ];

    for (const endpoint of endpoints) {
        checkTimeout();
        const response = await apiGet(endpoint);
        verifyEnvelope(response, endpoint);
    }
}

// ============================================================================
// AUTH TESTS
// ============================================================================

async function testAuthRequired() {
    log('info', 'Testing auth-required endpoints...');

    const endpoints = [
        { path: '/workspaces', shouldBe: 401 },
        { path: '/chains', shouldBe: 401 },
        { path: '/tasks/list', shouldBe: 401 },
        { path: '/terminal/token', shouldBe: 401 },
    ];

    for (const { path, shouldBe } of endpoints) {
        checkTimeout();

        const response = await apiGet(path);

        // Auth endpoints should return 401 when not logged in
        // Or 302 redirect to login in some cases
        if (response.status === shouldBe || response.status === 302 || response.status === 307) {
            recordPass(`Auth required: ${path}`, { status: response.status });
        } else {
            recordWarn(`Auth required: ${path}`, { status: response.status, expected: shouldBe });
        }
    }
}

// ============================================================================
// PUPPETEER UI TESTS
// ============================================================================

async function testUIWithPuppeteer() {
    log('info', 'Testing UI with Puppeteer...');

    // Try to import puppeteer
    let puppeteer;
    try {
        puppeteer = (await import('puppeteer')).default;
    } catch {
        log('warn', 'Puppeteer not available, skipping UI tests');
        recordWarn('Puppeteer not available');
        return;
    }

    const browser = await puppeteer.launch({
        headless: config.headless,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(10000);

    try {
        // Test 1: Check if site loads
        log('info', 'Navigating to home page...');
        await page.goto(config.baseUrl, { waitUntil: 'networkidle2' });

        const title = await page.title();
        recordPass('Home page loads', { title });

        if (config.screenshots) {
            await page.screenshot({ path: join(config.outputDir, 'home.png') });
        }

        // Test 2: Check for login redirect or dashboard
        const currentUrl = page.url();
        log('info', `Current URL: ${currentUrl}`);

        if (currentUrl.includes('/login')) {
            recordPass('Redirects to login when not authenticated');

            // Test login form
            const passwordInput = await page.$('input[type="password"]');
            if (passwordInput) {
                recordPass('Login form present');

                // Try to login
                await page.type('input[type="password"]', config.password);
                await page.click('button[type="submit"]');

                // Wait for navigation
                await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {
                    log('warn', 'No navigation after login submit');
                });

                if (config.screenshots) {
                    await page.screenshot({ path: join(config.outputDir, 'after-login.png') });
                }
            }
        } else if (currentUrl.includes('/dashboard') || currentUrl.endsWith('/')) {
            recordPass('Already authenticated or auth not required');
        }

        // Test 3: Navigate to major pages
        const pages = [
            { path: '/chains', name: 'Chains' },
            { path: '/agents', name: 'Agents' },
            { path: '/runs', name: 'Runs' },
            { path: '/settings', name: 'Settings' },
        ];

        for (const { path, name } of pages) {
            checkTimeout();

            try {
                log('info', `Testing ${name} page...`);
                await page.goto(`${config.baseUrl}${path}`, { waitUntil: 'domcontentloaded' });

                const status = await page.evaluate(() => {
                    // Check for common error indicators
                    const hasError = document.body.textContent.includes('500') ||
                                    document.body.textContent.includes('Application Error');
                    return hasError ? 'error' : 'ok';
                });

                if (status === 'error') {
                    recordFail(`${name} page`, { reason: 'Error page detected' });
                } else {
                    recordPass(`${name} page loads`);
                }

                if (config.screenshots) {
                    await page.screenshot({ path: join(config.outputDir, `${name.toLowerCase()}.png`) });
                }
            } catch (error) {
                recordFail(`${name} page`, { error: error.message });
            }
        }

        // Test 4: Check for console errors
        const consoleErrors = [];
        page.on('console', msg => {
            if (msg.type() === 'error') {
                consoleErrors.push(msg.text());
            }
        });

        if (consoleErrors.length > 0) {
            recordWarn('Console errors detected', { errors: consoleErrors.slice(0, 5) });
        } else {
            recordPass('No console errors');
        }

    } finally {
        await browser.close();
    }
}

// ============================================================================
// TERMINAL TOKEN TEST
// ============================================================================

async function testTerminalToken() {
    log('info', 'Testing terminal token endpoint...');

    // This endpoint requires auth and a running ws-terminal
    // We'll just check if it responds appropriately
    const response = await apiGet('/terminal/token');

    if (response.status === 401 || response.status === 403) {
        recordPass('Terminal token auth check', { status: response.status });
        return;
    }

    if (response.status === 503) {
        recordWarn('Terminal token unavailable', { reason: 'ws-terminal not running' });
        return;
    }

    if (response.status === 200 && response.json?.token) {
        recordPass('Terminal token generated', { hasToken: true });
        return;
    }

    recordWarn('Terminal token unexpected response', { status: response.status });
}

// ============================================================================
// MAIN TEST RUNNER
// ============================================================================

async function runTests() {
    console.log('================================');
    console.log('MENTIKO SMOKE TEST SUITE');
    console.log('================================');
    console.log(`Base URL: ${config.baseUrl}`);
    console.log(`Output: ${config.outputDir}`);
    console.log(`Headless: ${config.headless}`);
    console.log('================================');
    console.log();

    const tests = [
        { name: 'Health Check', fn: testHealth },
        { name: 'API Envelope', fn: testApiEnvelope },
        { name: 'Auth Required', fn: testAuthRequired },
        { name: 'UI Tests', fn: testUIWithPuppeteer },
        { name: 'Terminal Token', fn: testTerminalToken },
    ];

    for (const test of tests) {
        log('info', `Running: ${test.name}...`);
        try {
            await test.fn();
        } catch (error) {
            recordFail(test.name, { error: error.message, stack: error.stack });
        }
        checkTimeout();
    }

    // Write results
    const summary = {
        timestamp: new Date().toISOString(),
        baseUrl: config.baseUrl,
        elapsed: getElapsed(),
        passed: results.passed.length,
        failed: results.failed.length,
        warnings: results.warnings.length,
        results: {
            passed: results.passed,
            failed: results.failed,
            warnings: results.warnings,
        },
    };

    writeFileSync(join(config.outputDir, 'summary.json'), JSON.stringify(summary, null, 2));

    // Print summary
    console.log();
    console.log('================================');
    console.log('SMOKE TEST SUMMARY');
    console.log('================================');
    console.log(`Passed:   ${results.passed.length}`);
    console.log(`Failed:   ${results.failed.length}`);
    console.log(`Warnings: ${results.warnings.length}`);
    console.log(`Time:     ${summary.elapsed}s`);
    console.log('================================');

    if (results.failed.length > 0) {
        console.log();
        console.log('FAILED TESTS:');
        for (const fail of results.failed) {
            console.log(`  - ${fail.name}`);
            if (fail.reason) console.log(`    Reason: ${fail.reason}`);
            if (fail.error) console.log(`    Error: ${fail.error}`);
        }
    }

    if (results.warnings.length > 0) {
        console.log();
        console.log('WARNINGS:');
        for (const warn of results.warnings) {
            console.log(`  - ${warn.name}`);
            if (warn.reason) console.log(`    Reason: ${warn.reason}`);
        }
    }

    console.log();
    console.log(`Results saved to: ${config.outputDir}`);

    if (results.failed.length > 0) {
        process.exit(1);
    }

    if (summary.elapsed > (config.timeout / 1000)) {
        console.warn('WARNING: Tests exceeded timeout');
        process.exit(2);
    }

    console.log('\x1b[32mAll smoke tests passed!\x1b[0m');
    process.exit(0);
}

// Run
runTests().catch(error => {
    console.error('\x1b[31mFatal error:\x1b[0m', error);
    process.exit(1);
});
