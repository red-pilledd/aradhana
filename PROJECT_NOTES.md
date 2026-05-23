# Aradhana Cable Network — Automation Project

## GitHub Repository
URL: https://github.com/red-pilledd/aradhana
Branch: main
File: magikdigi_collections.js

## What This Script Does
Daily collections scraper for Aradhana Cable Network and Broadband Services, Kollam, Kerala.
Runs automatically at 6PM daily via Windows Task Scheduler.
Collects from two sources: MagikDigi (cable) and Kerala Vision (internet).
Also reads HDFC bank credit emails from Gmail to track UPI payments.
Sends results via email and WhatsApp.

## Time Window
Default: yesterday 6PM → today 6PM (18:00 → 18:00)
Flags: --today, --date DD-MM-YYYY, --from DD-MM-YYYY --to DD-MM-YYYY, --headed, --kv-only

## Business Details
Business: Aradhana Cable Network and Broadband Services
Location: Kollam, Kerala, India
~4000+ subscribers (2000 cable, 2000 cable+internet)
Kerala Vision LCO code: K02C001 (main account)

## Family / People
- Shibin (owner, runs script): shibn88@gmail.com, HDFC account ending 6380
- Father (Shanmughadas): shabup63@gmail.com, Federal Bank — receives email report
- Brother (Bibin): bibinshanmughadas@gmail.com, HDFC account ending 7482 — receives WhatsApp
- Mother (Sheeja): sheejaaradhana@gmail.com, HDFC account ending 6364

## File Locations on PC
Script: C:\Users\shibz\Documents\aradhana\magikdigi_collections.js
CSV output: C:\Users\shibz\Documents\aradhana\collections_today.csv
Run log: C:\Users\shibz\Documents\aradhana\run.log
Batch file: C:\Users\shibz\Documents\aradhana\run_collections.bat
Backups: C:\Users\shibz\Documents\aradhana\backup\
Chrome: C:\Program Files\Google\Chrome\Application\chrome.exe

## MagikDigi Cable Scraping
URL: https://digi.kccl.tv/index.php
Login fields: #uname, #upassword, #txtCaptcha, button#login
CAPTCHA: solved via Claude Vision API (claude-opus-4-5)
Accounts scraped (in order): K02C001, K02C005, K02C006, K02C007, K02C008, K02C014
Password: stored in script as CABLE_PASSWORD constant
Collections report URL: /index.php/reports/allcollections
Date fields: #from_date, #to_date
Search button: input[name="filterBtn"]

### Cable Pagination (IMPORTANT — hard to fix)
Portal uses plain anchor links, NO Bootstrap .pagination class.
Next page link HTML: <a href="/index.php/reports/allcollections/10">&gt;</a>
Solution: find anchor where innerHTML === '&gt;' and href contains 'allcollections', then navigate to that URL directly via page.goto().
Do NOT use page.click() on pagination — causes "Execution context was destroyed" error.
10 rows per page by default.

### Agent/Employee Collections
NOT scraped from separate /reports/collection page anymore.
Derived from the "Emp" column already present in All Collections table.
cableData rows are [account, ...originalRow], so header index j → row[j+1]
Broadband detection: if "Broadband UserID" column cell is non-empty → broadband payment.
Function: buildEmpAgg(cableHeaders, cableData)

## Kerala Vision Internet Scraping
URL: https://operator.keralavisionisp.com/Partner/BalTransHist.aspx
Login URL: https://operator.keralavisionisp.com/Partner/PortalLogin.aspx
Username: kb02c002
CAPTCHA element: #imgCapchanew, fill into #txtLoginCaptcha, click input#save
After login: redirects to CrmHomepage.aspx — dismiss popup then navigate to report

### KV Date Fields (CRITICAL — was buggy)
Date input IDs (specific, hardcoded):
  From: ContentPlaceHolder1_txtStartDate (also try txtStartDate)
  To:   ContentPlaceHolder1_txtEndDate   (also try txtEndDate)
DO NOT use generic name/id scanning — it accidentally fills ImageButton1 (name contains "Button" which contains "to")
Date format: "21 May 2026" (D MMM YYYY)

### KV Table
Table selector: [id$="gdCONSSN"]
Page size: set to 500 via select dropdown
Columns (in order): SrNo, Date, Reseller, User Id, Transaction Type, Amount, PlanName, Plan Cost, Transfer/Renew, Mobile, Address, ...
Filter: Dr entries only (not Cr), non-zero Plan Cost, AND within 6PM-6PM time window
Use Plan Cost column (index 7), not Amount column
Time filter uses parseDate() on Date column — KV date format is "22 May 2026 7:06 PM" which parseDate handles correctly
Pagination: KV uses its own pagination with > link — use page.evaluate to find and click

### KV Password Note
Password in script is 'Aradhana@123' (no # at end, unlike cable which is 'Aradhana@123#')

## HDFC UPI Email Reading
Gmail account: shibn88@gmail.com
IMAP: imap.gmail.com:993
App password: stored in GMAIL_APP_PASSWORD env var (set in run_collections.bat)
Library: imapflow + mailparser

### Email Sources (3 senders)
1. Direct HDFC: alerts@hdfcbank.bank.in → to shibn88@gmail.com (account 6380)
2. Sheeja forwards: sheejaaradhana@gmail.com → to shibn88@gmail.com (account 6364)
3. Bibin forwards: bibinshanmughadas@gmail.com → to shibn88@gmail.com (account 7482)

### IMAP Search (CRITICAL — nested OR for 3 senders)
IMAP OR only supports 2 operands. Must nest:
or: [
  { from: 'sheejaaradhana@gmail.com' },
  { or: [
    { from: 'bibinshanmughadas@gmail.com' },
    { from: 'hdfcbank' },
  ]},
]

### Email Parsing
Function: parseHdfcText(text, date)
Direct HDFC emails: HTML only (no plain text part) — must strip HTML tags to get text
Forwarded emails: have plain text body available

Format 1 (new HDFC HTML emails):
"Rs.XXX has been successfully credited to your HDFC Bank account ending in XXXX"
Regex: /Rs\.(\d+(?:\.\d{1,2})?)\s+has been successfully credited[\s\S]*?account ending\s+in\s+(\d+)/i
NOTE: "account ending" and "in XXXX" sometimes on separate lines — use \s+ not literal space

Format 2 (older SMS style):
"Rs.XXX credited to your a/c XXXX by UPI. UPI Ref XXXXXXXXXXXX"

Sender extracted from: "Sender: NAME (VPA: vpa@bank)"
UPI ref from: "UPI Reference No.: XXXXXXXXXX"

### HDFC Accounts
6380 = Shibin
6364 = Sheeja (Mother)
7482 = Bibin (Brother)

### Window Filter for Emails
emailDate = parsed.date (the FORWARDED date, not original transaction date)
This is fine — forwarded emails arrive within same day, still within 6PM-6PM window
Window: dateRange.windowStart to dateRange.windowEnd

## Email Report
From: shibn88@gmail.com
To: shabup63@gmail.com (Father)
SMTP: smtp.gmail.com:587
Library: nodemailer
HTML email with sections: Cable summary, KV table (first 20 rows), Agent table, UPI table, Cash in Hand
Attachment: collections_today.csv

## WhatsApp
Phone: 918281871096 (Bibin, brother — 91 = India)
Method: write message to temp file → PowerShell reads file → sets clipboard → opens whatsapp:// URL → UIAutomation or keybd_event to send

## Output CSV
Path: C:\Users\shibz\Documents\aradhana\collections_today.csv
Sections: Cable collections, Kerala Vision, Agent summary, HDFC UPI credits, Summary totals

## Credentials Storage
Anthropic API key: stored in ANTHROPIC_API_KEY environment variable (set in run_collections.bat)
Gmail app password: stored in GMAIL_APP_PASSWORD environment variable (set in run_collections.bat)
All other passwords (cable, KV) remain as constants in the script
GitHub repo is private

## Git Setup
Local git repo: C:\Users\shibz\Documents\aradhana\.git
Remote: https://github.com/red-pilledd/aradhana.git
.gitignore excludes: node_modules, *.log, run.log, collections_today.csv, backup/, .env

## Key Bugs Fixed (history, for reference)
1. KV date "to" field: was filling ImageButton1 by accident (name "ctl00$ImageButton1" contains "tto" which matches "to" substring). Fixed by targeting field IDs directly.
2. Cable pagination: portal uses plain <a href="/index.php/reports/allcollections/10">&gt;</a> links. Fixed by extracting href and using page.goto() instead of click().
3. HDFC email parsing: direct emails are HTML-only, no plain text. Fixed by stripping HTML tags as fallback.
4. HDFC regex: "account ending\r\nin" (line break mid-phrase). Fixed by using \s+ instead of literal space.
5. IMAP nested OR: 3 senders require nested OR conditions (IMAP OR only supports 2 operands).
6. Encoding: PowerShell heredocs corrupted UTF-8 emojis. Emojis replaced with plain text labels in WhatsApp.
7. Agent section: was scraping /reports/collection separately. Now derived from "Emp" column in All Collections — saves 6 page loads.
8. KV time filter: portal returns full day data, script filters to 6PM-6PM window using parseDate on Date column.

## Node.js Dependencies
playwright, @anthropic-ai/sdk, nodemailer, imapflow, mailparser

## How to Run
Daily automatic: Windows Task Scheduler runs run_collections.bat at 6PM
Manual test: node magikdigi_collections.js --headed --from 21-05-2026 --to 22-05-2026
Skip cable: node magikdigi_collections.js --kv-only
Show browser: add --headed flag
