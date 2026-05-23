'use strict';

// Aradhana Cable Network - Collections Script
// Accounts: K02C001, K02C005, K02C006, K02C007, K02C008, K02C014
// Internet: kb02c002 (operator.keralavisionisp.com)
// Email: shabup63@gmail.com (Father)
// WhatsApp: 8281871096 (Brother)
// Run: node magikdigi_collections.js
// Auto: Windows Task Scheduler 6PM daily

/**
 * magikdigi_collections.js
 * Daily collections scraper — Cable (digi.kccl.tv) + Internet (Kerala Vision)
 * Run daily at 6 PM via Task Scheduler.  Window: yesterday 18:00 → today 18:00.
 *
 * node magikdigi_collections.js            # default window
 * node magikdigi_collections.js --headed   # show browser
 * node magikdigi_collections.js --kv-only  # skip cable, KV only
 * node magikdigi_collections.js --date DD-MM-YYYY       # full calendar day
 * node magikdigi_collections.js --from DD-MM-YYYY --to DD-MM-YYYY
 * node magikdigi_collections.js --today    # midnight → now
 */

const { chromium }    = require('playwright');
const Anthropic        = require('@anthropic-ai/sdk');
const nodemailer       = require('nodemailer');
const fs               = require('fs');
const path             = require('path');
const { ImapFlow }     = require('imapflow');
const { simpleParser } = require('mailparser');

// ── Credentials ───────────────────────────────────────────────────────────────

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || 'REPLACE_WITH_YOUR_KEY';
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || 'REPLACE_WITH_APP_PASSWORD';

// ── Cable config ──────────────────────────────────────────────────────────────

const CABLE_BASE       = 'https://digi.kccl.tv';
const CABLE_LOGIN_URL  = `${CABLE_BASE}/index.php`;
const CABLE_COLL_URL   = `${CABLE_BASE}/index.php/reports/allcollections`;
const CABLE_ACCOUNTS   = ['K02C001', 'K02C005', 'K02C006', 'K02C007', 'K02C008', 'K02C014'];
const CABLE_PASSWORD   = 'Aradhana@123#';

// ── Kerala Vision config ──────────────────────────────────────────────────────

const KV_BASE       = 'https://operator.keralavisionisp.com/Partner';
const KV_LOGIN_URL  = `${KV_BASE}/Default.aspx`;
const KV_REPORT_URL = `${KV_BASE}/BalTransHist.aspx`;
const KV_ACCOUNTS = [
  { user: 'kb02c002', pass: 'Aradhana@123'  },
  { user: 'KB02C007', pass: 'Aradhana@123'  },
  { user: 'KB02C017', pass: 'Aradhana@123'  },
  { user: 'KB02C006', pass: 'KB02c006'      },
];

// ── Email config ──────────────────────────────────────────────────────────────

const EMAIL_FROM = 'shibn88@gmail.com';
const EMAIL_TO   = 'shabup63@gmail.com';

// ── WhatsApp config ───────────────────────────────────────────────────────────

const WA_PHONE = '918281871096';   // 91 = India country code

// ── HDFC account labels (last 4 digits → display name) ───────────────────────
// Add Bibin's and Sheeja's account last-4 here once known from the first run
const HDFC_ACCOUNTS = {
  '6380': 'Shibin',
  '6364': 'Sheeja (Mother)',
  '7482': 'Bibin (Brother)',
};

// ── Output ────────────────────────────────────────────────────────────────────

const CSV_PATH = 'C:\\Users\\shibz\\Documents\\aradhana\\collections_today.csv';

// ── Runtime flags ─────────────────────────────────────────────────────────────

const HEADED  = process.argv.includes('--headed');
const KV_ONLY = process.argv.includes('--kv-only');

// ── Anthropic client ──────────────────────────────────────────────────────────

const ai = new Anthropic({ apiKey: ANTHROPIC_KEY });

// ─────────────────────────────────────────────────────────────────────────────
// DATE RANGE
// ─────────────────────────────────────────────────────────────────────────────

function argVal(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] || null : null;
}

function parseDMY(str) {
  const m = str && str.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) throw new Error(`Bad date "${str}" — need DD-MM-YYYY`);
  return new Date(+m[3], +m[2] - 1, +m[1]);
}

function getDateRange() {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dmy   = d => `${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`;
  const kvFmt = d => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  const hm    = d => `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  const now   = new Date();

  if (process.argv.includes('--today')) {
    const ws = new Date(now); ws.setHours(0,0,0,0);
    return { fromDMY:dmy(ws), toDMY:dmy(now), fromKV:kvFmt(ws), toKV:kvFmt(now),
             windowStart:ws, windowEnd:new Date(now),
             label:`${dmy(ws)} 00:00 → ${dmy(now)} ${hm(now)}`, subject:`${dmy(now)} today` };
  }

  const dateArg = argVal('--date');
  if (dateArg) {
    const d  = parseDMY(dateArg);
    const ws = new Date(d); ws.setHours(0,0,0,0);
    const we = new Date(d); we.setDate(we.getDate()+1); we.setHours(0,0,0,0);
    return { fromDMY:dmy(d), toDMY:dmy(d), fromKV:kvFmt(d), toKV:kvFmt(d),
             windowStart:ws, windowEnd:we,
             label:`${dmy(d)} full day`, subject:dmy(d) };
  }

  const fromArg = argVal('--from'), toArg = argVal('--to');
  if (fromArg || toArg) {
    if (!fromArg || !toArg) throw new Error('--from and --to must be used together');
    const fd = parseDMY(fromArg), td = parseDMY(toArg);
    const ws = new Date(fd); ws.setHours(18,0,0,0);
    const we = new Date(td); we.setHours(18,0,0,0);
    return { fromDMY:dmy(fd), toDMY:dmy(td), fromKV:kvFmt(fd), toKV:kvFmt(td),
             windowStart:ws, windowEnd:we,
             label:`${dmy(fd)} 18:00 → ${dmy(td)} 18:00`, subject:`${dmy(fd)} → ${dmy(td)}` };
  }

  // Default: yesterday 18:00 → today 18:00
  const today = new Date(now);
  const yest  = new Date(now); yest.setDate(yest.getDate() - 1);
  const ws = new Date(yest); ws.setHours(18,0,0,0);
  const we = new Date(today); we.setHours(18,0,0,0);
  return { fromDMY:dmy(yest), toDMY:dmy(today), fromKV:kvFmt(yest), toKV:kvFmt(today),
           windowStart:ws, windowEnd:we,
           label:`${dmy(yest)} 18:00 → ${dmy(today)} 18:00`, subject:`${dmy(yest)} → ${dmy(today)}` };
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function inr(n) {
  return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2 });
}

function escapeCSV(val) {
  const s = String(val ?? '').trim();
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function parseDate(str) {
  if (!str) return null;
  const s = str.trim();
  let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return new Date(+m[3], +m[2]-1, +m[1], +m[4], +m[5], +(m[6]||0));
  m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return new Date(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +(m[6]||0));
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

function filterByWindow(rows, dateColIdx, windowStart, windowEnd) {
  if (!windowStart || !windowEnd || dateColIdx < 0) return rows;
  let kept=0, dropped=0;
  const out = rows.filter(row => {
    const d = parseDate(row[dateColIdx] ?? '');
    if (!d) { kept++; return true; }           // unparseable → keep (safe default)
    if (d >= windowStart && d < windowEnd) { kept++; return true; }
    dropped++; return false;
  });
  console.log(`    Time-filter: kept=${kept} dropped=${dropped}`);
  return out;
}

function sumCol(rows, idx) {
  if (idx < 0) return 0;
  return rows.reduce((s, r) => {
    const v = parseFloat(String(r[idx] ?? '').replace(/[₹,\s]/g, ''));
    return s + (isNaN(v) ? 0 : v);
  }, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT AGGREGATION — derived from All Collections Emp column
// ─────────────────────────────────────────────────────────────────────────────

function buildEmpAgg(cableHeaders, cableData) {
  const empAgg = {};
  if (!cableHeaders.length) return empAgg;
  const empIdx = cableHeaders.findIndex(h => /^emp$/i.test(h.trim()));
  const amtIdx = cableHeaders.findIndex(h => /^amount$|^amt$/i.test(h));
  const bbIdx  = cableHeaders.findIndex(h => /broadband.*user|bb.*user/i.test(h));
  console.log('  Agent cols — Emp:' + empIdx + ' Amount:' + amtIdx + ' BBUserID:' + bbIdx);
  if (empIdx < 0) { console.log('  [Agent] Emp column not found — skipping'); return empAgg; }
  for (const row of cableData) {
    const name = (row[empIdx + 1] ?? '').trim();
    if (!name) continue;
    const amt  = parseFloat(String(row[amtIdx + 1] ?? '').replace(/[₹,\s]/g, '')) || 0;
    const isBB = bbIdx >= 0 && (row[bbIdx + 1] ?? '').trim().length > 0;
    if (!empAgg[name]) empAgg[name] = { customers: 0, digitalTV: 0, broadband: 0 };
    empAgg[name].customers++;
    if (isBB) empAgg[name].broadband += amt;
    else      empAgg[name].digitalTV += amt;
  }
  return empAgg;
}

// ─────────────────────────────────────────────────────────────────────────────
// CABLE — LOGIN / LOGOUT
// ─────────────────────────────────────────────────────────────────────────────

async function solveCaptcha(page) {
  // Screenshot just the CAPTCHA image element → send to Claude Vision
  const imgEl = await page.$('#imgCaptcha');
  if (!imgEl) { console.log('    CAPTCHA element not found'); return null; }
  const imgBuf = await imgEl.screenshot();
  const b64    = imgBuf.toString('base64');
  const msg = await ai.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 16,
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } },
      { type: 'text',  text: 'This is a CAPTCHA. Reply with ONLY the characters shown, nothing else.' },
    ]}],
  });
  return msg.content[0].text.trim();
}

async function cableLogin(page, account) {
  await page.goto(CABLE_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // Wait explicitly for the login form; sometimes networkidle fires before form renders
  await page.waitForSelector('#uname', { timeout: 20000 });
  console.log(`  [${account}] Login page loaded (${page.url()})`);

  for (let attempt = 1; attempt <= 4; attempt++) {
    // Fill credentials
    await page.fill('#uname',    account,         { timeout: 10000 });
    await page.fill('#upassword', CABLE_PASSWORD, { timeout: 10000 });

    // Solve and fill CAPTCHA
    const captcha = await solveCaptcha(page);
    if (!captcha) throw new Error('Could not find CAPTCHA image');
    console.log(`  [${account}] Captcha attempt ${attempt}: "${captcha}"`);
    await page.fill('#txtCaptcha', captcha, { timeout: 5000 });

    // Click login button and wait for navigation
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
      page.click('button#login'),
    ]);

    // Success = login form INPUT is gone (dashboard navbar also has #uname as text, not input)
    const loginFormVisible = await page.isVisible('input#uname').catch(() => false);
    if (!loginFormVisible) {
      // Dismiss any notification/alert popup that appears after login
      await page.evaluate(() => {
        for (const btn of document.querySelectorAll('button, input[type="button"], a')) {
          const t = (btn.textContent || btn.value || '').trim().toUpperCase();
          if (t === 'OK' || t === 'CLOSE' || t === 'DISMISS') { btn.click(); return; }
        }
      }).catch(() => {});
      // Also handle browser-level dialog
      page.once('dialog', d => d.dismiss().catch(() => {}));
      await page.waitForTimeout(500);
      console.log(`  [${account}] Logged in ✓`);
      return;
    }
    console.log(`  [${account}] Attempt ${attempt} failed, retrying...`);
    await page.goto(CABLE_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#uname', { timeout: 20000 });
  }
  throw new Error(`Login failed for ${account} after 4 attempts`);
}

async function cableLogout(page) {
  // Clear all session state — cookies, localStorage, sessionStorage
  await page.context().clearCookies();
  await page.evaluate(() => {
    try { localStorage.clear(); } catch(_) {}
    try { sessionStorage.clear(); } catch(_) {}
  }).catch(() => {});

  // Navigate directly to login page and wait until URL is exactly the login URL
  await page.goto(CABLE_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForURL(url => url.toString() === CABLE_LOGIN_URL || url.toString().startsWith(CABLE_LOGIN_URL), { timeout: 10000 }).catch(() => {});
  await page.waitForSelector('input#uname', { timeout: 10000 });
  console.log(`  Session cleared ✓ — on login page`);
}

// ─────────────────────────────────────────────────────────────────────────────
// CABLE — SCRAPE COLLECTIONS
// ─────────────────────────────────────────────────────────────────────────────

async function scrapeCollections(page, account, fromDate, toDate) {
  console.log(`  [${account}] Collections ${fromDate} → ${toDate}`);
  await page.goto(CABLE_COLL_URL, { waitUntil: 'networkidle', timeout: 30000 });

  // Redirected to login? Skip this account.
  if (await page.isVisible('input#uname').catch(() => false)) {
    console.log(`  [${account}] Redirected to login — skipping`);
    return { headers: [], rows: [] };
  }

  // Fill date range (format DD-MM-YYYY)
  for (const sel of ['#from_date','#fromDate','input[name="from_date"]']) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
      await el.fill(fromDate); await el.blur().catch(()=>{}); break;
    }
  }
  for (const sel of ['#to_date','#toDate','input[name="to_date"]']) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
      await el.fill(toDate); await el.blur().catch(()=>{}); break;
    }
  }

  // Click the blue Search button
  for (const sel of ['input[name="filterBtn"]','button:has-text("Search")','input[value="Search"]',
                     'button[type="submit"]','input[type="submit"]']) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 2000 }).catch(() => false)) { await el.click(); break; }
  }
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2000);

  // Scrape table with pagination
  const allRows = []; let headers = []; let pageNum = 1;
  while (true) {
    const { hdrs, rows } = await page.evaluate(() => {
      const clean = el => {
        const c = el.cloneNode(true);
        c.querySelectorAll('script,style').forEach(s=>s.remove());
        return (c.innerText||c.textContent||'').replace(/\s+/g,' ').trim();
      };
      const t = document.querySelector('table.table.table-bordered, table.table-bordered');
      if (!t) return { hdrs:[], rows:[] };
      const hdrs = Array.from(t.querySelectorAll('thead th,thead td')).map(clean);
      const rows = Array.from(t.querySelectorAll('tbody tr'))
        .map(tr => Array.from(tr.querySelectorAll('td')).map(clean))
        .filter(r => r.some(c=>c.length>0))
        .filter(r => !r.some(c=>/Total Collection/i.test(c)));
      return { hdrs, rows };
    });
    if (pageNum === 1 && hdrs.length) headers = hdrs;
    allRows.push(...rows);
    console.log(`    Page ${pageNum}: ${rows.length} rows`);

    // Next page — MagikDigi uses /reports/allcollections/OFFSET URLs
    // Find the > link href and navigate to it directly
    const nextUrl = await page.evaluate(() => {
      for (const a of document.querySelectorAll('a')) {
        const raw = a.innerHTML.trim();
        const href = a.getAttribute('href') || '';
        // Match the > arrow link: innerHTML is &gt; or >
        if ((raw === '&gt;' || raw === '>') && href.includes('allcollections')) {
          return href;
        }
      }
      return null;
    });
    const clicked = nextUrl;
    if (nextUrl) {
      const fullUrl = nextUrl.startsWith('http') ? nextUrl : 'https://digi.kccl.tv' + nextUrl;
      await page.goto(fullUrl, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
    }
    if (!clicked) {
      // Debug: show what the pagination bar contains
      const pagDebug = await page.evaluate(() => {
        const pag = document.querySelector('.pagination');
        if (!pag) return 'NO .pagination ELEMENT';
        return pag.innerText.replace(/\s+/g,' ').trim();
      });
      console.log('    Pagination bar: ' + pagDebug);
      break;
    }
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(500);
    pageNum++;
  }
  return { headers, rows: allRows };
}


// ─────────────────────────────────────────────────────────────────────────────
// KERALA VISION — LOGIN + SCRAPE
// ─────────────────────────────────────────────────────────────────────────────

async function kvLogin(page, credentials) {
  // Go directly to the partner login page (PortalLogin.aspx)
  // Default.aspx redirects here anyway; going direct is cleaner
  const partnerLoginUrl = 'https://operator.keralavisionisp.com/Partner/PortalLogin.aspx';
  await page.goto(partnerLoginUrl, { waitUntil: 'networkidle', timeout: 30000 });

  const blocked = await page.evaluate(() =>
    document.body.innerText.toLowerCase().includes('blocked') ||
    document.body.innerText.toLowerCase().includes('too many')
  );
  if (blocked) throw new Error('KV partner account locked — too many failed attempts. Unblock at portal admin first.');

  for (let attempt = 1; attempt <= 4; attempt++) {
    await page.fill('#txtUserName', credentials.user);
    await page.fill('#txtPassword', credentials.pass);

    // Solve CAPTCHA (#imgCapchanew / #txtLoginCaptcha)
    const capImg = await page.$('#imgCapchanew');
    if (capImg) {
      const capBuf = await capImg.screenshot();
      const capMsg = await ai.messages.create({
        model: 'claude-opus-4-5', max_tokens: 16,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: capBuf.toString('base64') } },
          { type: 'text', text: 'This is a CAPTCHA. Reply with ONLY the characters shown, nothing else.' },
        ]}],
      });
      const cap = capMsg.content[0].text.trim();
      console.log(`  [KV] Captcha attempt ${attempt}: "${cap}"`);
      await page.fill('#txtLoginCaptcha', cap);
    } else {
      console.log(`  [KV] Attempt ${attempt}: no CAPTCHA element found`);
    }

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 20000 }).catch(() => {}),
      page.click('input[id="save"]'),
    ]);

    const url = page.url();
    console.log(`  [KV] Attempt ${attempt} URL: ${url}`);
    if (url.includes('crmhomepage') || (!url.includes('PortalLogin') && !url.includes('Login.aspx') && !url.includes('Default.aspx'))) {
      // Dismiss notification popup if present
      await page.evaluate(() => {
        for (const btn of document.querySelectorAll('input[value="Close"],button')) {
          if ((btn.value||btn.textContent||'').trim().toLowerCase() === 'close') { btn.click(); return; }
        }
      }).catch(() => {});
      await page.waitForTimeout(500);
      console.log('  [KV] Logged in ✓');
      return;
    }
    // Still on login — reload and retry
    await page.goto(partnerLoginUrl, { waitUntil: 'networkidle', timeout: 15000 });
  }
  throw new Error('KV login failed after 4 attempts');
}

async function kvScrapePage(page) {
  return page.evaluate(() => {
    const clean = el => {
      const c = el.cloneNode(true);
      c.querySelectorAll('script,style').forEach(s=>s.remove());
      return (c.innerText||c.textContent||'').replace(/\s+/g,' ').trim();
    };
    // Specific table ID gdCONSSN, fallback to any table with most columns
    let t = document.querySelector('[id$="gdCONSSN"]');
    if (!t) {
      let max=0;
      for (const tbl of document.querySelectorAll('table')) {
        const n = (tbl.querySelector('tr')||{querySelectorAll:()=>[]}).querySelectorAll('th,td').length;
        if (n>max) { max=n; t=tbl; }
      }
    }
    if (!t) return { hdrs:[], rows:[] };
    const hRow = t.querySelector('thead tr') || t.querySelector('tr');
    const hdrs = Array.from(hRow.querySelectorAll('th,td')).map(clean);
    const rows = Array.from(t.querySelectorAll('tbody tr, tr')).slice(1)
      .map(tr=>Array.from(tr.querySelectorAll('td')).map(clean))
      .filter(r=>r.length>0 && r.some(c=>c.length>0));
    return { hdrs, rows };
  });
}

async function scrapeKV(page, dateRange, credentials) {
  await kvLogin(page, credentials);

  // Navigate to report page
  await page.goto(KV_REPORT_URL, { waitUntil: 'networkidle', timeout: 30000 });
  const reportUrl = page.url();
  console.log(`  [KV] Report URL: ${reportUrl}`);
  if (reportUrl.includes('Login.aspx') || reportUrl.includes('Default.aspx') || reportUrl.includes('PortalLogin.aspx')) {
    throw new Error(`KV redirected to login — session lost. URL: ${reportUrl}`);
  }

  // Dump text inputs to confirm we're on the report page and find date field IDs
  const inputInfo = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input[type="text"],input:not([type="hidden"])')).map(e=>({id:e.id,name:e.name,val:e.value}))
  );
  console.log('  [KV] Text inputs on report page:', JSON.stringify(inputInfo));

  // Fill date fields — target KV-specific date inputs only (not buttons)
  const filled = await page.evaluate(([fromVal, toVal]) => {
    const result = {from: false, to: false, fromId: '', toId: ''};
    // KV portal uses these specific field IDs — target them directly first
    const knownFrom = ['ContentPlaceHolder1_txtStartDate', 'txtStartDate'];
    const knownTo   = ['ContentPlaceHolder1_txtEndDate',   'txtEndDate'];
    for (const fid of knownFrom) {
      const el = document.getElementById(fid);
      if (el) { el.value = fromVal; el.dispatchEvent(new Event('change',{bubbles:true})); result.from = true; result.fromId = fid; break; }
    }
    for (const tid of knownTo) {
      const el = document.getElementById(tid);
      if (el) { el.value = toVal; el.dispatchEvent(new Event('change',{bubbles:true})); result.to = true; result.toId = tid; break; }
    }
    // Fallback: scan text inputs but EXCLUDE buttons and inputs with 'button' in name
    if (!result.from || !result.to) {
      for (const inp of document.querySelectorAll('input[type="text"]')) {
        const id   = (inp.id   || '').toLowerCase();
        const name = (inp.name || '').toLowerCase();
        if (name.includes('button') || id.includes('button')) continue;
        const isDate = (v) => /^d{1,2}s+w+s+d{4}$/.test(v) || v === '';
        if (!result.from && (id.includes('startdate') || id.includes('txtstart') || name.includes('startdate'))) {
          inp.value = fromVal; inp.dispatchEvent(new Event('change',{bubbles:true}));
          result.from = true; result.fromId = inp.id||inp.name;
        } else if (!result.to && (id.includes('enddate') || id.includes('txtend') || name.includes('enddate'))) {
          inp.value = toVal; inp.dispatchEvent(new Event('change',{bubbles:true}));
          result.to = true; result.toId = inp.id||inp.name;
        }
      }
    }
    return result;
  }, [dateRange.fromKV, dateRange.toKV]);
  console.log(`  [KV] Date fill: from=${filled.from}(${filled.fromId}) to=${filled.to}(${filled.toId})`);
  console.log(`  [KV] Date range: ${dateRange.fromKV} → ${dateRange.toKV}`);

  // Click Show/Search button
  const btnClicked = await page.evaluate(() => {
    for (const inp of document.querySelectorAll('input[type="submit"],input[type="button"],button')) {
      const v = (inp.value || inp.textContent || '').trim().toLowerCase();
      if (v === 'show' || v === 'search' || v === 'go' || v === 'view') { inp.click(); return inp.value||inp.textContent||inp.id; }
    }
    return null;
  });
  console.log(`  [KV] Button clicked: ${btnClicked}`);
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);

  // Set 500 records per page — scan all <select> for a page-size dropdown and fire ASP.NET postback
  const psResult = await page.evaluate(() => {
    for (const sel of document.querySelectorAll('select')) {
      const opts = Array.from(sel.options).map(o => ({ val: o.value, num: Number(o.value) || Number(o.text) }));
      if (!opts.some(o => o.num >= 50)) continue;          // not a page-size dropdown
      const want = [500, 200, 100, 50].find(t => opts.some(o => o.num === t))
                   || Math.max(...opts.map(o => o.num).filter(n => n > 0));
      const match = opts.find(o => o.num === want);
      if (!match) continue;
      sel.value = match.val;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      // Fire ASP.NET __doPostBack if the select uses it
      const oc = sel.getAttribute('onchange') || '';
      const m  = oc.match(/__doPostBack\('([^']+)'/);
      if (m) { try { window.__doPostBack(m[1], ''); } catch(_) {} }
      return want;
    }
    return null;
  });
  if (psResult) {
    console.log(`  [KV] Page size → ${psResult}`);
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);
  } else {
    console.log(`  [KV] Page size dropdown not found — using portal default`);
  }

  // Paginate
  const allRows = []; let kvHeaders = []; let pageNum = 1;
  while (true) {
    const { hdrs, rows } = await kvScrapePage(page);
    if (pageNum === 1 && hdrs.length) kvHeaders = hdrs;
    allRows.push(...rows);
    console.log(`    Page ${pageNum}: ${rows.length} rows`);

    const clicked = await page.evaluate(() => {
      const candidates = [
        ...document.querySelectorAll('[id$="gdCONSSN"] a'),
        ...document.querySelectorAll('[id$="GridView1"] a'),
      ];
      for (const a of candidates) {
        if (a.textContent.trim() === '>') { a.click(); return true; }
      }
      return false;
    });
    if (!clicked) break;
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1000);
    pageNum++;
  }

  // ── Post-filter: Dr rows, non-zero PlanCost, within time window ──────────
  const txIdx   = kvHeaders.findIndex(h => /trans.*type|type/i.test(h));
  const pcIdx   = kvHeaders.findIndex(h => /plan.?cost|plancost/i.test(h));
  const amtIdx  = pcIdx >= 0 ? pcIdx : kvHeaders.findIndex(h => /amount|amt/i.test(h));
  const dateIdx = kvHeaders.findIndex(h => /date/i.test(h));
  console.log(`  [KV] Totalling via column: ${pcIdx>=0?`PlanCost (${pcIdx})`:`Amount (${amtIdx})`}`);

  let dropCr=0, dropZero=0, dropTime=0;
  const { windowStart, windowEnd } = dateRange;
  const filtered = allRows.filter(row => {
    const type = txIdx>=0 ? String(row[txIdx]??'').trim() : 'Dr';
    if (!/^dr$/i.test(type)) { dropCr++; return false; }
    const amt = parseFloat(String(row[amtIdx]??'').replace(/[₹,\s]/g,''));
    if (isNaN(amt)||amt<=0) { dropZero++; return false; }
    if (windowStart && windowEnd && dateIdx>=0) {
      const d = parseDate(row[dateIdx]??'');
      if (d && (d<windowStart || d>=windowEnd)) { dropTime++; return false; }
    }
    return true;
  });
  console.log('  [KV] Kept: ' + filtered.length + '  (Cr=' + dropCr + ' zero=' + dropZero + ' outside=' + dropTime + ')');
  return { headers: kvHeaders, rows: filtered, amtIdx };
}

// ─────────────────────────────────────────────────────────────────────────────
// GMAIL — HDFC UPI CREDIT READING
// ─────────────────────────────────────────────────────────────────────────────

function parseHdfcText(text, date) {
  if (!text) return null;

  // Format 1: "Rs.XXX credited to your a/c XXXX by UPI. UPI Ref XXXXXXXXXXXX"
  let m = text.match(/Rs\.(\d+(?:\.\d{1,2})?)\s+credited to your a\/c\s+(\w+)\s+by UPI[.\s]+UPI Ref[:\s]+(\w+)/i);
  if (m) {
    return {
      amount: parseFloat(m[1]),
      account: m[2].replace(/\D/g, '').slice(-4),
      upiRef: m[3].trim(),
      sender: '',
      vpa: '',
      date,
    };
  }

  // Format 2: "Rs.XXX has been successfully credited to your HDFC Bank account ending in XXXX"
  m = text.match(/Rs\.(\d+(?:\.\d{1,2})?)\s+has been successfully credited[\s\S]*?account ending\s+in\s+(\d+)/i);
  if (m) {
    const amount  = parseFloat(m[1]);
    const account = m[2].slice(-4);
    let sender = '', vpa = '', upiRef = '';
    const sm = text.match(/Sender[:\s]+(.+?)\s*\(VPA[:\s]+([^)]+)\)/i);
    if (sm) { sender = sm[1].trim(); vpa = sm[2].trim(); }
    const rm = text.match(/UPI\s*Ref(?:erence)?[:\s#]+(\w+)/i);
    if (rm) upiRef = rm[1].trim();
    return { amount, account, upiRef, sender, vpa, date };
  }

  return null;
}

async function readHdfcEmails(dateRange) {
  const payments = [];
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: EMAIL_FROM, pass: GMAIL_APP_PASSWORD },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      // IMAP SINCE is day-level — start from day before window to catch 18:00 boundary
      const sinceDate = new Date(dateRange.windowStart);
      sinceDate.setHours(0, 0, 0, 0);

      const seqs = await client.search({
        since: sinceDate,
        or: [
          { from: 'sheejaaradhana@gmail.com' },
          { or: [
            { from: 'bibinshanmughadas@gmail.com' },
            { from: 'hdfcbank' },
          ]},
        ],
      });
      console.log(`  [Gmail] ${seqs.length} HDFC candidate email(s) since ${sinceDate.toDateString()}`);

      if (seqs.length > 0) {
        for await (const msg of client.fetch(seqs, { source: true })) {
          const parsed = await simpleParser(msg.source);
          const emailDate = parsed.date || new Date();

          // Hour-level window filter
          if (emailDate < dateRange.windowStart || emailDate >= dateRange.windowEnd) continue;

          // Use plain text if available, otherwise strip HTML
          const rawText = parsed.text || '';
          const htmlText = parsed.html ? parsed.html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s{2,}/g,' ') : '';
          const text = rawText.length > 50 ? rawText : htmlText;
          const subj = parsed.subject || '';
          const payment = parseHdfcText(text + '\n' + subj, emailDate);
          if (payment) {
            payments.push(payment);
            console.log(`    UPI ₹${payment.amount} → a/c ...${payment.account} ref:${payment.upiRef||'—'} sender:${payment.sender||'—'}`);
          }
        }
      }
    } finally {
      lock.release();
    }
    await client.logout();
  } catch(e) {
    console.error(`  [Gmail] HDFC email read failed: ${e.message}`);
  }

  console.log(`  [Gmail] ${payments.length} UPI credit(s) in window`);
  return payments;
}

function aggregateUpi(payments) {
  const byAccount = {};
  for (const p of payments) {
    if (!byAccount[p.account]) byAccount[p.account] = { count: 0, total: 0, payments: [] };
    byAccount[p.account].count++;
    byAccount[p.account].total += p.amount;
    byAccount[p.account].payments.push(p);
  }
  return byAccount;
}

// ─────────────────────────────────────────────────────────────────────────────
// EMAIL
// ─────────────────────────────────────────────────────────────────────────────

function buildEmail({ dateRange, perAccount, cableData, cableTotal,
                      kvData, kvHeaders, kvAmtIdx, kvTotal, grandTotal,
                      cableHeaders, empAgg, upiByAccount, upiTotal }) {
  const th = 'background:#1a3a5c;color:#fff;padding:8px 12px;text-align:left;font-size:13px';
  const td = 'padding:7px 12px;border-bottom:1px solid #e0e0e0;font-size:13px';

  // Cable rows
  let cableRows = '';
  for (const [acc,v] of Object.entries(perAccount)) {
    cableRows += `<tr><td style="${td}">${acc}</td><td style="${td}">${v.count}</td>
      <td style="${td};text-align:right">${inr(v.amount)}</td></tr>`;
  }

  // KV preview (first 20)
  const kvColDate = kvHeaders.findIndex(h=>/date/i.test(h));
  const kvColUser = kvHeaders.findIndex(h=>/user.?id|userid/i.test(h));
  const kvColPlan = kvHeaders.findIndex(h=>/plan.?name|planname/i.test(h));
  const get = (row,i) => i>=0 ? (row[i]??'') : '';
  let kvRows = '';
  for (const row of kvData.slice(0,20)) {
    kvRows += `<tr>
      <td style="${td}">${get(row,kvColDate)}</td>
      <td style="${td}">${get(row,kvColUser)}</td>
      <td style="${td}">${get(row,kvColPlan)}</td>
      <td style="${td};text-align:right">${inr(parseFloat(String(get(row,kvAmtIdx)).replace(/[₹,\s]/g,''))||0)}</td>
    </tr>`;
  }
  if (kvData.length>20) kvRows+=`<tr><td colspan="4" style="${td};color:#888;font-style:italic">
    …${kvData.length-20} more in CSV</td></tr>`;

  // Agent section
  let agentSection = '';
  const agents = Object.entries(empAgg||{});
  if (agents.length) {
    let empRows='', totC=0, totD=0, totB=0;
    for (const [name,v] of agents) {
      const tot=v.digitalTV+v.broadband;
      totC+=v.customers; totD+=v.digitalTV; totB+=v.broadband;
      empRows+=`<tr><td style="${td}">${name}</td>
        <td style="${td};text-align:center">${v.customers}</td>
        <td style="${td};text-align:right">${inr(v.digitalTV)}</td>
        <td style="${td};text-align:right">${inr(v.broadband)}</td>
        <td style="${td};text-align:right;font-weight:bold">${inr(tot)}</td></tr>`;
    }
    empRows+=`<tr style="background:#1a3a5c">
      <td style="padding:8px 12px;color:#fff;font-weight:bold">TOTAL</td>
      <td style="padding:8px 12px;color:#fff;text-align:center">${totC}</td>
      <td style="padding:8px 12px;color:#fff;text-align:right">${inr(totD)}</td>
      <td style="padding:8px 12px;color:#fff;text-align:right">${inr(totB)}</td>
      <td style="padding:8px 12px;color:#fff;text-align:right;font-weight:bold">${inr(totD+totB)}</td></tr>`;
    agentSection = `
    <h3 style="color:#1a3a5c;margin:20px 0 8px;font-size:15px">
      👤 Agent Collections</h3>
    <table width="100%" cellspacing="0" style="border:1px solid #dde3ea;border-radius:6px;overflow:hidden;margin-bottom:20px">
      <thead><tr>
        <th style="${th}">Agent</th><th style="${th};text-align:center">Customers</th>
        <th style="${th};text-align:right">Digital TV</th><th style="${th};text-align:right">Broadband</th>
        <th style="${th};text-align:right">Total</th>
      </tr></thead><tbody>${empRows}</tbody>
    </table>`;
  }

  const cashInHand = grandTotal - upiTotal;

  // UPI per-account rows for email
  let upiAcctRows = '';
  const upiAcctEntries = Object.entries(upiByAccount || {});
  if (upiAcctEntries.length) {
    for (const [acct, v] of upiAcctEntries) {
      const label = HDFC_ACCOUNTS[acct] || `Account ${acct}`;
      upiAcctRows += `<tr>
        <td style="${td}">${label} (${acct})</td>
        <td style="${td};text-align:center">${v.count}</td>
        <td style="${td};text-align:right">${inr(v.total)}</td>
      </tr>`;
    }
  } else {
    upiAcctRows = `<tr><td colspan="3" style="${td};color:#888;font-style:italic">No UPI credits in this window</td></tr>`;
  }
  const upiSection = `
    <h3 style="color:#1a3a5c;margin:20px 0 8px;font-size:15px">💳 UPI Received (HDFC)</h3>
    <table width="100%" cellspacing="0" style="border:1px solid #dde3ea;border-radius:6px;overflow:hidden;margin-bottom:16px">
      <thead><tr>
        <th style="${th}">Account</th>
        <th style="${th};text-align:center">Payments</th>
        <th style="${th};text-align:right">Amount</th>
      </tr></thead>
      <tbody>${upiAcctRows}</tbody>
      <tfoot><tr style="background:#1a3a5c">
        <td style="padding:8px 12px;color:#fff;font-weight:bold">Total UPI</td>
        <td style="padding:8px 12px;color:#fff;text-align:center">${upiAcctEntries.reduce((s,[,v])=>s+v.count,0)}</td>
        <td style="padding:8px 12px;color:#fff;text-align:right;font-weight:bold">${inr(upiTotal)}</td>
      </tr></tfoot>
    </table>
    <table width="100%" cellspacing="0" style="margin-bottom:24px">
      <tr>
        <td style="padding:14px 16px;background:#e8f5e9;border-radius:6px;border:1px solid #c8e6c9">
          <div style="font-size:12px;color:#2e7d32">💰 Cash in Hand (Grand − UPI)</div>
          <div style="font-size:24px;font-weight:bold;color:#1b5e20">${inr(cashInHand)}</div>
        </td>
      </tr>
    </table>`;

  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f0f4f8;padding:20px;margin:0">
<div style="max-width:700px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)">
  <div style="background:#1a3a5c;padding:20px 24px">
    <h2 style="color:#fff;margin:0;font-size:20px">Aradhana Collections Report</h2>
    <p style="color:#a8d4f0;margin:6px 0 0;font-size:13px">${dateRange.label}</p>
  </div>
  <div style="padding:24px">
    <!-- Summary tiles row 1 -->
    <table width="100%" cellspacing="0" style="margin-bottom:8px">
      <tr>
        <td style="padding:16px;background:#f5f9ff;border-right:1px solid #dde3ea">
          <div style="font-size:12px;color:#666">📡 Cable Total</div>
          <div style="font-size:22px;font-weight:bold;color:#1a3a5c">${inr(cableTotal)}</div>
          <div style="font-size:12px;color:#888">${cableData.length} records</div>
        </td>
        <td style="padding:16px;background:#eef4fb;border-right:1px solid #dde3ea">
          <div style="font-size:12px;color:#666">🌐 Internet (MRP)</div>
          <div style="font-size:22px;font-weight:bold;color:#1a3a5c">${inr(kvTotal)}</div>
          <div style="font-size:12px;color:#888">${kvData.length} records</div>
        </td>
        <td style="padding:16px;background:#1a3a5c">
          <div style="font-size:12px;color:#a8d4f0">Grand Total</div>
          <div style="font-size:26px;font-weight:bold;color:#fff">${inr(grandTotal)}</div>
          <div style="font-size:12px;color:#a8d4f0">${cableData.length+kvData.length} records</div>
        </td>
      </tr>
    </table>
    <!-- Summary tiles row 2: UPI + Cash -->
    <table width="100%" cellspacing="0" style="margin-bottom:24px">
      <tr>
        <td style="padding:14px 16px;background:#fff8e1;border-right:1px solid #dde3ea;border-top:1px solid #dde3ea">
          <div style="font-size:12px;color:#666">💳 UPI Received</div>
          <div style="font-size:20px;font-weight:bold;color:#e65100">${inr(upiTotal)}</div>
          <div style="font-size:12px;color:#888">${upiAcctEntries.reduce((s,[,v])=>s+v.count,0)} payments</div>
        </td>
        <td style="padding:14px 16px;background:#e8f5e9;border-top:1px solid #dde3ea">
          <div style="font-size:12px;color:#2e7d32">💰 Cash in Hand</div>
          <div style="font-size:20px;font-weight:bold;color:#1b5e20">${inr(cashInHand)}</div>
          <div style="font-size:12px;color:#888">Grand − UPI</div>
        </td>
      </tr>
    </table>

    <!-- Cable -->
    <h3 style="color:#1a3a5c;margin:0 0 8px;font-size:15px">📡 Cable Collections (MagikDigi)</h3>
    <table width="100%" cellspacing="0" style="border:1px solid #dde3ea;border-radius:6px;overflow:hidden;margin-bottom:24px">
      <thead><tr>
        <th style="${th}">Account</th><th style="${th}">Records</th>
        <th style="${th};text-align:right">Amount</th>
      </tr></thead>
      <tbody>${cableRows}</tbody>
      <tfoot><tr style="background:#1a3a5c">
        <td style="padding:8px 12px;color:#fff;font-weight:bold">Total</td>
        <td style="padding:8px 12px;color:#fff">${cableData.length}</td>
        <td style="padding:8px 12px;color:#fff;text-align:right;font-weight:bold">${inr(cableTotal)}</td>
      </tr></tfoot>
    </table>

    <!-- Kerala Vision -->
    <h3 style="color:#1a3a5c;margin:0 0 8px;font-size:15px">🌐 Internet (Kerala Vision) — PlanCost MRP</h3>
    <table width="100%" cellspacing="0" style="border:1px solid #dde3ea;border-radius:6px;overflow:hidden;margin-bottom:24px">
      <thead><tr>
        <th style="${th}">Date</th><th style="${th}">User ID</th>
        <th style="${th}">Plan</th><th style="${th};text-align:right">PlanCost</th>
      </tr></thead>
      <tbody>${kvRows}</tbody>
      <tfoot><tr style="background:#1a3a5c">
        <td colspan="2" style="padding:8px 12px;color:#fff;font-weight:bold">Total</td>
        <td style="padding:8px 12px;color:#fff;font-weight:bold;text-align:right">${inr(kvTotal)}</td>
        <td style="padding:8px 12px;color:#a8d4f0;font-size:12px">${kvData.length} records (all accounts) — full data in CSV</td>
      </tr></tfoot>
    </table>

    ${agentSection}
    ${upiSection}
  </div>
</div>
</body></html>`;
}

async function sendEmail(data) {
  const transport = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: EMAIL_FROM, pass: GMAIL_APP_PASSWORD },
  });
  const subject = `Aradhana Collections — ${data.dateRange.subject}`;
  const html    = buildEmail(data);
  const cashInHand = data.grandTotal - (data.upiTotal || 0);
  const text    = [
    `Aradhana Collections — ${data.dateRange.label}`,
    `Cable Total:    ${inr(data.cableTotal)} (${data.cableData.length} records)`,
    `Internet Total: ${inr(data.kvTotal)} (${data.kvData.length} records)`,
    `Grand Total:    ${inr(data.grandTotal)}`,
    `UPI Received:   ${inr(data.upiTotal || 0)}`,
    `Cash in Hand:   ${inr(cashInHand)}`,
  ].join('\n');
  await transport.sendMail({
    from: `"Aradhana Collections" <${EMAIL_FROM}>`,
    to: EMAIL_TO, subject, html, text,
    attachments: [{ filename: 'collections_today.csv', path: CSV_PATH }],
  });
  console.log(`\nEmail sent → ${EMAIL_TO} ✓`);
}

// ─────────────────────────────────────────────────────────────────────────────
// WHATSAPP (Desktop app via whatsapp:// URL scheme)
// ─────────────────────────────────────────────────────────────────────────────

function buildWhatsAppMsg({ dateRange, perAccount, cableTotal, kvTotal, grandTotal,
                            cableData, kvData, empAgg, upiByAccount, upiTotal }) {
  const lines = [
    `*Aradhana Collections*`,
    dateRange.label, ``,
    `📡 *Cable (MagikDigi)*`,
  ];
  for (const [acc,v] of Object.entries(perAccount)) {
    if (v.count>0) lines.push(`  ${acc}: ${inr(v.amount)} (${v.count})`);
  }
  lines.push(`  *Total: ${inr(cableTotal)}* (${cableData.length} records)`, ``);
  lines.push(`🌐 *Internet (Kerala Vision)* — MRP`);
  lines.push(`  ${inr(kvTotal)} (${kvData.length} records)`, ``);
  lines.push(`💰 *Grand Total: ${inr(grandTotal)}* (${cableData.length+kvData.length} records)`);

  const agents = Object.entries(empAgg||{}).filter(([,v])=>v.customers>0);
  if (agents.length) {
    lines.push(``, `👤 *Agent Collections*`);
    for (const [name,v] of agents)
      lines.push(`  ${name}: ${inr(v.digitalTV+v.broadband)} (${v.customers} cust)`);
  }

  const upiEntries = Object.entries(upiByAccount || {});
  lines.push(``, `💳 *UPI Received (HDFC)*`);
  if (upiEntries.length) {
    for (const [acct, v] of upiEntries) {
      const label = HDFC_ACCOUNTS[acct] || `Account ${acct}`;
      lines.push(`  ${label} (${acct}): ${inr(v.total)} (${v.count})`);
    }
  } else {
    lines.push(`  No UPI credits`);
  }
  lines.push(`  *Total UPI: ${inr(upiTotal || 0)}*`);
  lines.push(``, `💵 *Cash in Hand: ${inr(grandTotal - (upiTotal || 0))}*`);

  return lines.join('\n');
}

async function sendWhatsApp(message) {
  const { spawnSync } = require('child_process');
  const tmpFile = path.join(require('os').tmpdir(), 'aradhana_wa.txt');
  fs.writeFileSync(tmpFile, message, 'utf8');
  const tmpPs = tmpFile.replace(/\\/g,'\\\\');
  console.log(`\n── WhatsApp → ${WA_PHONE} ──`);

  const ps = `
$ErrorActionPreference = 'SilentlyContinue'
$msg = [System.IO.File]::ReadAllText('${tmpPs}', [System.Text.Encoding]::UTF8)

# Put full message on clipboard — avoids whatsapp:// URL length limit
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Clipboard]::SetText($msg)

# Open WhatsApp to the contact — no text in URL so nothing gets truncated
Start-Process "whatsapp://send?phone=${WA_PHONE}"
Start-Sleep -Seconds 10

$wa = Get-Process | Where-Object { $_.ProcessName -match 'WhatsApp' -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $wa) { Write-Output 'NOT_FOUND'; exit }

Add-Type -Language CSharp -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public class WH {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a,uint b,bool c);
  [DllImport("user32.dll")] public static extern void keybd_event(byte v,byte s,uint f,IntPtr e);
  public static void Focus(IntPtr h){
    ShowWindow(h,9); uint d;
    uint fg=GetWindowThreadProcessId(GetForegroundWindow(),out d);
    uint me=GetCurrentThreadId();
    AttachThreadInput(me,fg,true); SetForegroundWindow(h); AttachThreadInput(me,fg,false);
  }
  public static void CtrlV(){
    keybd_event(0x11,0,0,IntPtr.Zero);
    System.Threading.Thread.Sleep(50);
    keybd_event(0x56,0,0,IntPtr.Zero);
    System.Threading.Thread.Sleep(80);
    keybd_event(0x56,0,2,IntPtr.Zero);
    System.Threading.Thread.Sleep(50);
    keybd_event(0x11,0,2,IntPtr.Zero);
  }
  public static void Enter(){
    keybd_event(0x0D,0,0,IntPtr.Zero);
    System.Threading.Thread.Sleep(60);
    keybd_event(0x0D,0,2,IntPtr.Zero);
  }
}
'@ -ErrorAction SilentlyContinue

[WH]::Focus($wa.MainWindowHandle)
Start-Sleep -Milliseconds 1200

# Paste full message from clipboard then send
[WH]::Focus($wa.MainWindowHandle)
Start-Sleep -Milliseconds 600
[WH]::CtrlV()
Start-Sleep -Milliseconds 800

# Try UIAutomation Send button first
Add-Type -AssemblyName UIAutomationClient -ErrorAction SilentlyContinue
Add-Type -AssemblyName UIAutomationTypes  -ErrorAction SilentlyContinue
$sent=$false
try {
  $el=$([System.Windows.Automation.AutomationElement]::FromHandle($wa.MainWindowHandle))
  $sc=[System.Windows.Automation.TreeScope]::Descendants
  $tp=[System.Windows.Automation.AutomationElement]::ControlTypeProperty
  $np=[System.Windows.Automation.AutomationElement]::NameProperty
  $bt=[System.Windows.Automation.ControlType]::Button
  foreach($lbl in @('Send','Send message','Send Message')){
    $c=New-Object System.Windows.Automation.AndCondition(
      (New-Object System.Windows.Automation.PropertyCondition($tp,$bt)),
      (New-Object System.Windows.Automation.PropertyCondition($np,$lbl)))
    $b=$el.FindFirst($sc,$c)
    if($b){$b.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke();$sent=$true;Write-Output 'SENT_UIA';break}
  }
} catch{}

if(-not $sent){
  [WH]::Focus($wa.MainWindowHandle); Start-Sleep -Milliseconds 600
  [WH]::Enter(); Start-Sleep -Milliseconds 600
  Write-Output 'SENT_KEY'
}`;

  const r = spawnSync('powershell',['-NoProfile','-NonInteractive','-Command',ps],{timeout:55000,encoding:'utf8'});
  const out = (r.stdout||'')+(r.stderr||'');
  if (out.includes('SENT_UIA'))  console.log('  [WA] Sent via UIAutomation ✓');
  else if (out.includes('SENT_KEY')) console.log('  [WA] Sent via keybd_event ✓');
  else if (out.includes('NOT_FOUND')) console.log('  [WA] WhatsApp not running');
  else console.log(`  [WA] Result: ${out.trim().slice(0,200)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const DR = getDateRange();
  console.log(`\n${'═'.repeat(54)}`);
  console.log(`  Aradhana Collections Scraper`);
  console.log(`  Window: ${DR.label}`);
  console.log(`${'═'.repeat(54)}\n`);

  // ── Chrome browser — MagikDigi cable scraping ─────────────────────────────
  const browser = await chromium.launch({
    headless: !HEADED,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    slowMo: HEADED ? 80 : 0,
  });
  const ctx  = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  // ── PART 1: Cable accounts ─────────────────────────────────────────────────
  const cableHeaders = [];
  const cableData    = [];            // [account, ...row]
  const perAccount   = {};

  if (KV_ONLY) {
    console.log('  [--kv-only] Skipping cable.\n');
    for (const acc of CABLE_ACCOUNTS) perAccount[acc]={count:0,amount:0};
  } else {
    for (const acc of CABLE_ACCOUNTS) {
      console.log(`\n── Cable: ${acc} ──`);
      try {
        await cableLogin(page, acc);

        // Collections — portal filters by date, we filter by time in code
        const { headers, rows: rawRows } = await scrapeCollections(page, acc, DR.fromDMY, DR.toDMY);
        if (headers.length && !cableHeaders.length) {
          cableHeaders.push(...headers);
        }
        const dateCol = (cableHeaders.length ? cableHeaders : headers)
          .findIndex(h => /date|time/i.test(h));
        const rows = filterByWindow(rawRows, dateCol, DR.windowStart, DR.windowEnd);
        for (const row of rows) cableData.push([acc, ...row]);

        const amtCol = (cableHeaders.length ? cableHeaders : headers)
          .findIndex(h => /^amount$|^amt$/i.test(h));
        const amount = sumCol(rows, amtCol);
        perAccount[acc] = { count: rows.length, amount };
        console.log(`  [${acc}] ${rows.length} rows  ${inr(amount)}`);

        // Explicit logout — wait for redirect back to login page before next account
        await cableLogout(page);
      } catch(e) {
        console.error(`  [${acc}] FAILED: ${e.message}`);
        perAccount[acc]={count:0,amount:0};
        // Clear session so next account starts clean
        await cableLogout(page).catch(()=>{});
      }
    }
  }

  const cableTotal = Object.values(perAccount).reduce((s,v)=>s+v.amount, 0);

  // Build agent aggregation from Emp column in All Collections
  const empAgg = buildEmpAgg(cableHeaders, cableData);
  if (Object.keys(empAgg).length) {
    console.log('\n  Agent summary (' + Object.keys(empAgg).length + ' agents):');
    for (const [name,v] of Object.entries(empAgg))
      console.log('    ' + name + ': ' + v.customers + ' collections  DTV:' + inr(v.digitalTV) + '  BB:' + inr(v.broadband));
  }

  // ── Close Chrome (cable) then reopen for Kerala Vision ────────────────────
  await browser.close();

  // ── PART 2: Kerala Vision — all accounts ─────────────────────────────────
  console.log(`\n── Kerala Vision Broadband ──`);
  let kvHeaders=[]; const kvData=[]; let kvTotal=0; let kvAmtIdx=0;
  const kvPerAccount = {};

  for (const kvCred of KV_ACCOUNTS) {
    console.log(`\n── KV: ${kvCred.user} ──`);
    const kvBrowser = await chromium.launch({
      headless: !HEADED,
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      slowMo: HEADED ? 80 : 0,
    });
    const kvCtx  = await kvBrowser.newContext({ viewport: { width: 1280, height: 800 } });
    const kvPage = await kvCtx.newPage();
    try {
      const { headers, rows, amtIdx } = await scrapeKV(kvPage, DR, kvCred);
      if (headers.length && !kvHeaders.length) kvHeaders = headers;
      kvData.push(...rows);
      kvAmtIdx = amtIdx;
      const acctTotal = sumCol(rows, amtIdx);
      kvPerAccount[kvCred.user] = { count: rows.length, amount: acctTotal };
      kvTotal += acctTotal;
      console.log(`  [KV:${kvCred.user}] ${rows.length} rows  ${inr(acctTotal)}`);
    } catch(e) {
      console.error(`  [KV:${kvCred.user}] FAILED: ${e.message}`);
      kvPerAccount[kvCred.user] = { count: 0, amount: 0 };
    }
    await kvBrowser.close();
  }
  const grandTotal = cableTotal + kvTotal;

  // ── PART 3: Gmail — HDFC UPI credits ──────────────────────────────────────
  console.log(`\n── HDFC UPI Credits (Gmail) ──`);
  const upiPayments   = await readHdfcEmails(DR);
  const upiByAccount  = aggregateUpi(upiPayments);
  const upiTotal      = upiPayments.reduce((s, p) => s + p.amount, 0);
  const cashInHand    = grandTotal - upiTotal;

  // ── Save CSV ───────────────────────────────────────────────────────────────
  const csvLines = [];
  csvLines.push([`=== CABLE COLLECTIONS — ${DR.label} ===`]);
  if (cableHeaders.length) csvLines.push(['Account',...cableHeaders]);
  for (const row of cableData) csvLines.push(row);
  csvLines.push([]);

  csvLines.push([`=== KERALA VISION — ${DR.fromKV} → ${DR.toKV} (Dr, PlanCost MRP) ===`]);
  if (kvHeaders.length) csvLines.push(['KVISION',...kvHeaders]);
  for (const row of kvData) csvLines.push(['KVISION',...row]);
  csvLines.push([]);

  if (Object.keys(empAgg).length) {
    csvLines.push(['=== AGENT SUMMARY ===']);
    csvLines.push(['Agent','Collections','Digital TV','Broadband','Total']);
    for (const [name,v] of Object.entries(empAgg))
      csvLines.push([name, v.customers, v.digitalTV.toFixed(2), v.broadband.toFixed(2), (v.digitalTV+v.broadband).toFixed(2)]);
    csvLines.push([]);
  }

  if (upiPayments.length) {
    csvLines.push([`=== HDFC UPI CREDITS — ${DR.label} ===`]);
    csvLines.push(['Date','Account','Amount','UPI Ref','Sender','VPA']);
    for (const p of upiPayments)
      csvLines.push([p.date.toLocaleString(), p.account, p.amount.toFixed(2), p.upiRef, p.sender, p.vpa]);
    csvLines.push([]);
  }

  csvLines.push(['=== SUMMARY ===']);
  csvLines.push(['Source','Records','Amount (₹)']);
  for (const [acc,v] of Object.entries(perAccount)) csvLines.push([acc, v.count, v.amount.toFixed(2)]);
  csvLines.push(['Cable Total', cableData.length, cableTotal.toFixed(2)]);
  csvLines.push(['Internet (KV)', kvData.length, kvTotal.toFixed(2)]);
  csvLines.push(['Grand Total', cableData.length+kvData.length, grandTotal.toFixed(2)]);
  csvLines.push(['UPI Received', upiPayments.length, upiTotal.toFixed(2)]);
  csvLines.push(['Cash in Hand', '', cashInHand.toFixed(2)]);

  fs.writeFileSync(CSV_PATH, csvLines.map(r=>r.map(escapeCSV).join(',')).join('\n'), 'utf8');
  console.log(`\nSaved → ${CSV_PATH}`);

  // ── Console report ─────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(54)}`);
  console.log(`  FINAL REPORT — ${DR.label}`);
  console.log(`${'═'.repeat(54)}`);
  console.log(`\n  📡 Cable (MagikDigi)`);
  for (const [acc,v] of Object.entries(perAccount)) {
    const s = v.count>0 ? `${inr(v.amount).padStart(13)}   (${v.count})` : `${'₹0.00'.padStart(13)}   (no collections)`;
    console.log(`    ${acc}:  ${s}`);
  }
  console.log(`    ${'─'.repeat(44)}`);
  console.log(`    Cable Total:  ${inr(cableTotal).padStart(13)}   (${cableData.length} records)\n`);
  console.log(`  🌐 Internet (Kerala Vision) — PlanCost MRP`);
  for (const [acc, v] of Object.entries(kvPerAccount)) {
    const s = v.count > 0 ? `${inr(v.amount).padStart(13)}   (${v.count})` : `${'₹0.00'.padStart(13)}   (no records)`;
    console.log(`    ${acc}:  ${s}`);
  }
  console.log(`    ${'─'.repeat(44)}`);
  console.log(`    KV Total:     ${inr(kvTotal).padStart(13)}   (${kvData.length} records)`);

  if (Object.keys(empAgg).length) {
    console.log(`\n  👤 Agent Collections`);
    const nw = Math.max(20,...Object.keys(empAgg).map(n=>n.length));
    console.log(`    ${'Agent'.padEnd(nw)}  Cust  Digital TV      Broadband       Total`);
    console.log(`    ${'─'.repeat(nw+52)}`);
    let tc=0,td=0,tb=0;
    for (const [name,v] of Object.entries(empAgg)) {
      const tot=v.digitalTV+v.broadband;
      console.log(`    ${name.padEnd(nw)}  ${String(v.customers).padStart(4)}  ${inr(v.digitalTV).padStart(12)}  ${inr(v.broadband).padStart(12)}  ${inr(tot).padStart(12)}`);
      tc+=v.customers; td+=v.digitalTV; tb+=v.broadband;
    }
    console.log(`    ${'─'.repeat(nw+52)}`);
    console.log(`    ${'TOTAL'.padEnd(nw)}  ${String(tc).padStart(4)}  ${inr(td).padStart(12)}  ${inr(tb).padStart(12)}  ${inr(td+tb).padStart(12)}`);
  }
  console.log(`\n  💳 UPI Received (HDFC)`);
  const upiEntries = Object.entries(upiByAccount);
  if (upiEntries.length) {
    for (const [acct, v] of upiEntries) {
      const label = HDFC_ACCOUNTS[acct] || `Account ${acct}`;
      console.log(`    ${label} (${acct}):  ${inr(v.total).padStart(13)}   (${v.count} payments)`);
    }
  } else {
    console.log(`    No UPI credits in this window`);
  }
  console.log(`    ${'─'.repeat(44)}`);
  console.log(`    UPI Total:    ${inr(upiTotal).padStart(13)}`);

  console.log(`\n${'─'.repeat(54)}`);
  console.log(`  GRAND TOTAL:  ${inr(grandTotal).padStart(13)}   (${cableData.length+kvData.length} records)`);
  console.log(`  UPI Received: ${inr(upiTotal).padStart(13)}`);
  console.log(`  CASH IN HAND: ${inr(cashInHand).padStart(13)}`);
  console.log(`${'═'.repeat(54)}\n`);

  // ── Email + WhatsApp ───────────────────────────────────────────────────────
  await sendEmail({ dateRange:DR, perAccount, cableData, cableTotal,
                    kvData, kvHeaders, kvAmtIdx, kvTotal, grandTotal,
                    cableHeaders, empAgg, upiByAccount, upiTotal });

  await sendWhatsApp(buildWhatsAppMsg({ dateRange:DR, perAccount, cableTotal,
                                        kvTotal, grandTotal, cableData, kvData,
                                        empAgg, upiByAccount, upiTotal }));
  console.log('Done.');
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
