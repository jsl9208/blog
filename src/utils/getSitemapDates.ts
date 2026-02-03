import fs from "node:fs";
import path from "node:path";
import slugify from "slugify";

const BLOG_PATH = "src/data/blog";

function slugifyStr(str: string): string {
  return slugify(str, { lower: true, trim: true });
}

interface PostMeta {
  pubDatetime: string;
  modDatetime?: string;
  draft?: boolean;
}

function parseFrontmatter(content: string): PostMeta | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const frontmatter = match[1];
  const meta: Partial<PostMeta> = {};

  const pubMatch = frontmatter.match(/pubDatetime:\s*(.+)/);
  if (pubMatch) meta.pubDatetime = pubMatch[1].trim();

  const modMatch = frontmatter.match(/modDatetime:\s*(.+)/);
  if (modMatch) meta.modDatetime = modMatch[1].trim();

  const draftMatch = frontmatter.match(/draft:\s*(.+)/);
  if (draftMatch) meta.draft = draftMatch[1].trim() === "true";

  if (!meta.pubDatetime) return null;
  return meta as PostMeta;
}

function buildUrlFromFile(filePath: string, baseUrl: string): string {
  const normalizedBase = baseUrl.replace(/\/$/, "");
  const relativePath = filePath.replace(/\\/g, "/");
  const parts = relativePath.split("/");

  const langIndex = parts.findIndex(p => p === "en" || p === "zh");
  const lang = langIndex >= 0 ? parts[langIndex] : "en";

  const filename = parts[parts.length - 1];
  const slug = slugifyStr(filename.replace(/\.md$/, ""));

  const prefix = lang === "en" ? "" : "/zh";
  return `${normalizedBase}${prefix}/posts/${slug}/`;
}

export function getSitemapDates(baseUrl: string): Map<string, Date> {
  const dateMap = new Map<string, Date>();
  const blogDir = path.resolve(process.cwd(), BLOG_PATH);

  function scanDir(dir: string) {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!entry.name.startsWith("_")) {
          scanDir(fullPath);
        }
      } else if (entry.name.endsWith(".md") && !entry.name.startsWith("_")) {
        const content = fs.readFileSync(fullPath, "utf-8");
        const meta = parseFrontmatter(content);

        if (!meta || meta.draft) continue;

        const url = buildUrlFromFile(fullPath, baseUrl);
        const lastmod = new Date(meta.modDatetime || meta.pubDatetime);

        if (!isNaN(lastmod.getTime())) {
          dateMap.set(url, lastmod);
        }
      }
    }
  }

  scanDir(blogDir);
  return dateMap;
}
