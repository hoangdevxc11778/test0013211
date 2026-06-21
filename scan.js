const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const URLS = [
  "cuongthonggio.com"
];

const proxies = fs.readFileSync('proxy.txt', 'utf8')
  .split('\n')
  .map(l => l.trim())
  .filter(Boolean);

function getRandomProxy() {
  return proxies.length > 0 ? proxies[Math.floor(Math.random() * proxies.length)] : null;
}

async function analyzePage(url, proxy) {
  const args = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];
  if (proxy) args.push(`--proxy-server=${proxy}`);
  const browser = await puppeteer.launch({ headless: true, args });
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    const title = await page.title();
    const content = await page.evaluate(() => document.body.innerText);
    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a')).map(a => a.href)
    );
    const forms = await page.evaluate(() =>
      document.querySelectorAll('form').length
    );
    const images = await page.evaluate(() =>
      document.querySelectorAll('img').length
    );
    const hasLogin = await page.evaluate(() => {
      const text = document.body.innerText.toLowerCase();
      return /password|login|\u0111\u0103ng nh\u1eadp|m\u1eadt kh\u1ea9u/.test(text);
    });

    const screenshotPath = `results/screenshot-${Date.now()}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });

    return {
      url,
      title,
      contentLength: content.length,
      links: links.length,
      forms,
      images,
      hasLogin,
      proxy: proxy || null,
      screenshot: screenshotPath,
    };
  } catch (err) {
    return { url, error: err.message, proxy: proxy || null };
  } finally {
    await browser.close();
    if (proxyServer && proxyChain) {
      try { await proxyChain.closeAnonymizedProxy(proxyServer, true); } catch(e) {}
    }
  }
}

async function runAiAnalysis(data) {
  const provider = process.env.AI_PROVIDER;
  const apiKey = process.env.AI_API_KEY;
  if (!provider || !apiKey) return null;

  const prompt = `Phân tích rủi ro website từ dữ liệu sau:
URL: ${data.url}
Tiêu đề: ${data.title}
Số link: ${data.links}
Số form: ${data.forms}
Số ảnh: ${data.images}
Có form đăng nhập: ${data.hasLogin ? 'Có' : 'Không'}
Độ dài nội dung: ${data.contentLength}

Hãy đánh giá mức độ rủi ro (Low/Medium/High/Very High) và giải thích ngắn gọn.`;

  try {
    if (provider === 'openai') {
      const res = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
      }, {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
      });
      return res.data.choices[0].message.content;
    } else if (provider === 'gemini') {
      const res = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
        { contents: [{ parts: [{ text: prompt }] }] }
      );
      return res.data.candidates?.[0]?.content?.parts?.[0]?.text || null;
    }
  } catch (e) {
    return null;
  }
  return null;
}

async function main() {
  if (!fs.existsSync('results')) fs.mkdirSync('results', { recursive: true });
  const results = [];
  for (const url of URLS) {
    const proxy = getRandomProxy();
    const pageData = await analyzePage(url, proxy);
    if (!pageData.error) {
      const aiResult = await runAiAnalysis(pageData);
      pageData.aiAnalysis = aiResult;
    }
    results.push(pageData);
  }
  fs.writeFileSync('results/scan-result.json', JSON.stringify(results, null, 2));
  console.log('Scan completed!');
  console.log(JSON.stringify(results, null, 2));
}

main().catch(console.error);
