const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
  });
  const page = await browser.newPage();
  const msgs = [];
  page.on('pageerror', e => msgs.push('pageerror: ' + e.message));
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto('http://localhost:3000/marketplace', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: 'db-nft-mode.png' });

  const tabs = await page.$$('[role="tab"]');
  await tabs[1].click();
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: 'db-art-mode.png' });

  console.log(msgs.length ? msgs.join('\n') : 'no page errors');
  await browser.close();
})();
