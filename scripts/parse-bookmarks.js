// scripts/parse-bookmarks.js
export function parseBookmarks(htmlContent) {
  const links = [];
  const linkRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
  let match;
  while ((match = linkRegex.exec(htmlContent)) !== null) {
    links.push({
      url: match[1],
      title: match[2].replace(/<[^>]+>/g, '').trim()
    });
  }
  return links;
}

export function generateMockDataJS(links) {
  const data = { bookmarks: links };
  return `export default ${JSON.stringify(data, null, 2)};`;
}