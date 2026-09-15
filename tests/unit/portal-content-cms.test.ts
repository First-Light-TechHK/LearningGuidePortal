import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyTranslatedBanners,
  applyTranslatedCategories,
  bundledPortalImages,
  defaultPortalContent,
  localiseHref,
  otherLocale,
  sourceCopyFingerprint,
  translationIsCurrent,
  withSharedBannerImages
} from "../../lib/portalContent";
import { parseJsonPayload } from "../../services/portalTranslate";

test("banner copy is authored once and applied to the other locale", () => {
  const source = defaultPortalContent.banners["en-GB"];
  const translated = applyTranslatedBanners(source, [
    { eyebrow: "学习指南", title: "标题一", text: "简介一", cta: "浏览" },
    { eyebrow: "开始", title: "标题二", text: "简介二", cta: "查看" },
    { eyebrow: "我的学习", title: "标题三", text: "简介三", cta: "进入" }
  ], "zh-CN");
  assert.equal(translated[0].image, source[0].image);
  assert.equal(translated[0].href, "/zh-CN/portal/courses");
  assert.equal(translated[2].href, "/zh-CN/account/my-learning");
  assert.equal(translated[0].title, "标题一");
});

test("translate-once stays skipped until the source copy changes", () => {
  const source = "en-GB" as const;
  const hash = sourceCopyFingerprint(defaultPortalContent, source);
  const current = { ...defaultPortalContent, translation: { source, hash } };
  assert.equal(translationIsCurrent(current, source), true);
  const edited = {
    ...current,
    banners: {
      ...current.banners,
      "en-GB": current.banners["en-GB"].map((banner, index) => index === 0 ? { ...banner, title: "New heading" } : banner)
    }
  };
  assert.equal(translationIsCurrent(edited, source), false);
  assert.equal(otherLocale(source), "zh-CN");
});

test("banner images are shared across languages", () => {
  const content = withSharedBannerImages({
    ...defaultPortalContent,
    banners: {
      "en-GB": defaultPortalContent.banners["en-GB"].map((banner, index) => index === 0 ? { ...banner, image: "/api/portal-media/media_aaaaaaaaaaaaaaaa" } : banner),
      "zh-CN": defaultPortalContent.banners["zh-CN"]
    }
  });
  assert.equal(content.banners["en-GB"][0].image, "/api/portal-media/media_aaaaaaaaaaaaaaaa");
  assert.equal(content.banners["zh-CN"][0].image, "/api/portal-media/media_aaaaaaaaaaaaaaaa");
  assert.deepEqual(bundledPortalImages(), ["/portal/auth-library.jpg", "/portal/course-book.jpg", "/portal/course-study.jpg"]);
});

test("locale prefixes in hrefs follow the target language", () => {
  assert.equal(localiseHref("/en-GB/portal/courses", "zh-CN"), "/zh-CN/portal/courses");
  assert.equal(localiseHref("https://example.com/path", "zh-CN"), "https://example.com/path");
});

test("translated category labels fill the other locale only", () => {
  const categories = applyTranslatedCategories(defaultPortalContent.categories, ["中国人文", "欧洲人文", "科学"], "zh-CN");
  assert.equal(categories[0].labels["en-GB"], "Chinese Humanities");
  assert.equal(categories[2].labels["zh-CN"], "科学");
});

test("model JSON can be read from a fenced payload", () => {
  const parsed = parseJsonPayload<{ banners: Array<{ title: string }> }>("```json\n{\"banners\":[{\"title\":\"Hello\"}]}\n```");
  assert.equal(parsed.banners[0].title, "Hello");
});
