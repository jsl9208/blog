import type { CollectionEntry } from "astro:content";

export const LOCALES = ["en", "zh"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

// IDs from glob loader: "zh/oh-my-opencode-part-1" or "en/oh-my-opencode-part-1"
// Files without a locale prefix (e.g. examples/) default to "en".
export function getLangFromId(id: string): Locale {
  const firstSegment = id.split("/")[0];
  if (LOCALES.includes(firstSegment as Locale)) {
    return firstSegment as Locale;
  }
  return DEFAULT_LOCALE;
}

// "zh/oh-my-opencode-part-1" → "oh-my-opencode-part-1"
export function getSlugFromId(id: string): string {
  const firstSegment = id.split("/")[0];
  if (LOCALES.includes(firstSegment as Locale)) {
    return id.slice(firstSegment.length + 1);
  }
  return id;
}

export function getPostsByLang(
  posts: CollectionEntry<"blog">[],
  lang: Locale
): CollectionEntry<"blog">[] {
  return posts.filter(post => getLangFromId(post.id) === lang);
}

// EN (default) → "", ZH → "/zh"
export function getLocalePrefix(lang: Locale): string {
  return lang === DEFAULT_LOCALE ? "" : `/${lang}`;
}

export function getPostUrl(lang: Locale, slug: string): string {
  const prefix = getLocalePrefix(lang);
  return `${prefix}/posts/${slug}`;
}

export function getLangLabel(lang: Locale): string {
  return UI_TRANSLATIONS[lang]._langLabel;
}

export const UI_TRANSLATIONS = {
  en: {
    _langLabel: "EN",
    _langName: "English",
    posts: "Posts",
    tags: "Tags",
    about: "About",
    archives: "Archives",
    search: "Search",
    allPosts: "All Posts",
    allPostsDesc: "All the articles I've posted.",
    recentPosts: "Recent Posts",
    featured: "Featured",
    tagPrefix: "Tag:",
    tagDesc: (tag: string) => `All the articles with the tag "${tag}".`,
    archivesDesc: "All the articles I've archived.",
    searchDesc: "Search any article ...",
    skipToContent: "Skip to content",
    socialLinks: "Social Links:",
    openMenu: "Open Menu",
    closeMenu: "Close Menu",
    readingTime: (min: number) => `${min} min read`,
  },
  zh: {
    _langLabel: "中文",
    _langName: "中文",
    posts: "文章",
    tags: "标签",
    about: "关于",
    archives: "归档",
    search: "搜索",
    allPosts: "所有文章",
    allPostsDesc: "我发布过的所有文章。",
    recentPosts: "最新文章",
    featured: "精选",
    tagPrefix: "标签：",
    tagDesc: (tag: string) => `所有包含「${tag}」标签的文章。`,
    archivesDesc: "所有归档文章。",
    searchDesc: "搜索文章……",
    skipToContent: "跳到内容",
    socialLinks: "社交链接：",
    openMenu: "打开菜单",
    closeMenu: "关闭菜单",
    readingTime: (min: number) => `${min} 分钟阅读`,
  },
} as const;

export type UITranslations = (typeof UI_TRANSLATIONS)[Locale];

export function t(lang: Locale): UITranslations {
  return UI_TRANSLATIONS[lang];
}
