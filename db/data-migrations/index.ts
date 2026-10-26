import type { DataMigration } from "./types";
import * as addStoicism from "./001_add_stoicism";
import * as gitDevRdsProbe from "./002_git_dev_rds_probe";
import * as addQuintusHoratiusFlaccus from "./003_add_quintus_horatius_flaccus";
import * as migrateMvpMediaToAws from "./004_migrate_mvp_media_to_aws";
import * as backfillLessonSummaries from "./005_backfill_lesson_summaries";
import * as addModelingLifeCourse from "./006_add_modeling_life_course";
import * as repairModelingLifeMedia from "./007_repair_modeling_life_media";
import * as upgradeModelingLife from "./008_upgrade_modeling_life";
import * as fixModelingLifeExhibits from "./009_fix_modeling_life_exhibits";
import * as fixModelingLifeMediaUrls from "./011_fix_modeling_life_media_urls";
import * as logicalModelingLifeMedia from "./013_logical_modeling_life_media";
import * as shortenDevScienceSubscription from "./014_shorten_dev_science_subscription";
import * as addModelingLifeLesson2Assessments from "./015_add_modeling_life_lesson2_assessments";
import * as addModelingLifeLesson1TextExhibits from "./016_add_modeling_life_lesson1_text_exhibits";
import * as fixModelingLifeVideoStarts from "./017_fix_modeling_life_video_starts";

// Keep shipped ledger identities. Their pending media-copy work is superseded
// by 008's repository images and logical course-media URLs, including on fresh SIT.
function supersededMediaImport(migration: DataMigration): DataMigration {
  return { ...migration, touches: ["courses"], apply: () => [{ action: "skip", kind: "course", id: "modeling-life", reason: "superseded-by-008_upgrade_modeling_life" }] };
}

export const dataMigrations: DataMigration[] = [addStoicism, gitDevRdsProbe, addQuintusHoratiusFlaccus, migrateMvpMediaToAws, backfillLessonSummaries, supersededMediaImport(addModelingLifeCourse), supersededMediaImport(repairModelingLifeMedia), upgradeModelingLife, fixModelingLifeExhibits, fixModelingLifeMediaUrls, logicalModelingLifeMedia, shortenDevScienceSubscription, addModelingLifeLesson2Assessments, addModelingLifeLesson1TextExhibits, fixModelingLifeVideoStarts];
export { type DataChange, type DataMigration, type DataMigrationContext, type DataMigrationDomain } from "./types";
