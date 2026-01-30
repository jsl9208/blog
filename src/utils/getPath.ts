import { BLOG_PATH } from "@/content.config";
import { slugifyStr } from "./slugify";
import { getLangFromId, getLocalePrefix, LOCALES } from "@/i18n";

export function getPath(
  id: string,
  filePath: string | undefined,
  includeBase = true
) {
  const lang = getLangFromId(id);
  const localePrefix = getLocalePrefix(lang);

  const pathSegments = filePath
    ?.replace(BLOG_PATH, "")
    .split("/")
    .filter(path => path !== "")
    .filter(path => !path.startsWith("_"))
    .filter(path => !LOCALES.includes(path as (typeof LOCALES)[number]))
    .slice(0, -1)
    .map(segment => slugifyStr(segment));

  const basePath = includeBase ? "/posts" : "";

  const blogId = id.split("/");
  const slug = blogId.length > 0 ? blogId.slice(-1) : blogId;

  if (!pathSegments || pathSegments.length < 1) {
    return [localePrefix + basePath, slug].join("/");
  }

  return [localePrefix + basePath, ...pathSegments, slug].join("/");
}
