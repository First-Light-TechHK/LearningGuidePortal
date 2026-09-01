import { listCourses } from "../services/courseStore";
import { listReleases } from "../services/releaseStore";
import { getWikiPage } from "../services/wikiStore";
import { ensureScienceTopics } from "../services/scienceSeed";
import { SCIENCE_FIELDS, SCIENCE_TOPICS } from "../services/scienceTopics";

async function main() {
  await ensureScienceTopics();
  const courses = await listCourses();
  for (const field of SCIENCE_FIELDS) {
    const course = courses.find((item) => item.id === field.id);
    if (!course) throw new Error(`${field.title} course was not seeded.`);
    const expected = SCIENCE_TOPICS.filter((topic) => topic.field === field.id).map((topic) => topic.id);
    for (const topicId of expected) {
      if (!course.knowledgeIds.includes(topicId)) {
        throw new Error(`${field.title} is missing topic ${topicId}`);
      }
    }
  }
  for (const topic of SCIENCE_TOPICS) {
    const page = await getWikiPage(topic.field, topic.id);
    const releases = await listReleases(topic.field, topic.id);
    if (!page?.entries?.length) throw new Error(`Missing wiki for ${topic.field}/${topic.id}`);
    if (!releases.length) throw new Error(`Missing release for ${topic.field}/${topic.id}`);
    const markdown = page.entries.map((entry) => entry.content).join("\n");
    if (!markdown.includes("$$")) throw new Error(`${topic.id} wiki has no display formula`);
    if (topic.figurePath && !markdown.includes(topic.figurePath)) {
      throw new Error(`${topic.id} wiki is missing ${topic.figurePath}`);
    }
    if (!topic.sourceFiles.length) throw new Error(`${topic.id} has no source files`);
    console.log(`ok ${topic.field}/${topic.id} entries=${page.entries.length} release=${releases[0].id}`);
  }
  console.log(`Field courses ready: ${SCIENCE_FIELDS.map((field) => field.id).join(", ")}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
