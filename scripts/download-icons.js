// scripts/download-icons.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 配置
const MOCK_DATA_PATH = path.resolve('../src/data/mock_data.js'); // 👈 根据你的实际路径调整
const OUTPUT_DIR = path.resolve('../public/sitelogo');           // 👈 图标输出目录

// 确保输出目录存在
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// 从 mock_data.js 中提取 JSON 数据
function parseMockData(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const match = content.match(/export\s+const\s+mockData\s*=\s*(\{[\s\S]*\});?\s*$/);
  if (!match) {
    throw new Error('无法解析 mock_data.js，请检查格式');
  }
  return JSON.parse(match[1]);
}

// 获取 favicon URL（尝试多种常见路径）
function getFaviconUrl(siteUrl) {
  try {
    const url = new URL(siteUrl);
    const origin = url.origin;
    return [
      `${origin}/favicon.ico`,
      `${origin}/apple-touch-icon.png`,
      `${origin}/apple-touch-icon-precomposed.png`,
      `${origin}/icon.png`,
      `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=64`,
    ];
  } catch (e) {
    return [];
  }
}

// 下载文件
async function downloadFile(url, outputPath) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Favicon Downloader)'
      }
    });

    clearTimeout(timeoutId);

    if (!response.ok || response.status === 404) return false;

    const buffer = await response.arrayBuffer();
    // 简单判断是否是有效图片（非 HTML 错误页）
    const firstBytes = new Uint8Array(buffer).slice(0, 4);
    const isImage = 
      (firstBytes[0] === 0x89 && firstBytes[1] === 0x50 && firstBytes[2] === 0x4E) || // PNG
      (firstBytes[0] === 0xFF && firstBytes[1] === 0xD8) || // JPEG
      (firstBytes[0] === 0x00 && firstBytes[1] === 0x00 && firstBytes[2] === 0x01) || // ICO (部分)
      (buffer.byteLength > 100); // fallback: 只要不是极小文件就认为有效

    if (isImage) {
      fs.writeFileSync(outputPath, Buffer.from(buffer));
      return true;
    }
  } catch (e) {
    // console.warn(`下载失败: ${url}`, e.message);
  }
  return false;
}

// 主函数
async function main() {
  console.log('🔍 正在读取书签数据...');
  const data = parseMockData(MOCK_DATA_PATH);

  const urls = new Set();
  for (const category of data.categories) {
    for (const site of category.sites) {
      if (site.url) urls.add(site.url);
    }
  }

  console.log(`✅ 共发现 ${urls.size} 个唯一书签`);

  let downloaded = 0;
  let skipped = 0;

  for (const url of urls) {
    try {
      const hostname = new URL(url).hostname.replace(/^www\./, '');
      const iconPath = path.join(OUTPUT_DIR, `${hostname}.ico`);

      // 跳过已存在的
      if (fs.existsSync(iconPath)) {
        skipped++;
        continue;
      }

      const faviconUrls = getFaviconUrl(url);
      let success = false;

      for (const favUrl of faviconUrls) {
        if (await downloadFile(favUrl, iconPath)) {
          success = true;
          break;
        }
      }

      if (success) {
        console.log(`📥 下载成功: ${hostname}.ico`);
        downloaded++;
      } else {
        console.log(`❌ 下载失败: ${hostname}`);
        // 可选：写一个占位符或默认图标
        // fs.copyFileSync(path.resolve('./default.ico'), iconPath);
      }
    } catch (e) {
      console.warn(`⚠️ 跳过无效 URL: ${url}`);
    }
  }

  console.log(`\n🎉 完成！新增图标: ${downloaded}，已存在: ${skipped}`);
}

// 运行
main().catch(console.error);
