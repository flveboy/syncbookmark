// scripts/parse-bookmarks.js
function parseBookmarks(htmlContent) {
  const links = [];
  // 匹配 <a href="...">...</a>，支持单引号或双引号
  const linkRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
  let match;
  while ((match = linkRegex.exec(htmlContent)) !== null) {
    // 移除标题中的 HTML 标签（如 <b>, <i> 等）
    const cleanTitle = match[2].replace(/<[^>]+>/g, '').trim();
    links.push({
      url: match[1],
      title: cleanTitle || 'Untitled'
    });
  }
  return links;
}

function generateMockDataJS(links) {
  const data = { bookmarks: links };
  return `export default ${JSON.stringify(data, null, 2)};`;
}

module.exports = { parseBookmarks, generateMockDataJS };