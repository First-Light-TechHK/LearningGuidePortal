import type { DataMigration } from "./types";
import * as addStoicism from "./001_add_stoicism";
import * as gitDevRdsProbe from "./002_git_dev_rds_probe";
import * as addQuintusHoratiusFlaccus from "./003_add_quintus_horatius_flaccus";
import * as migrateMvpMediaToAws from "./004_migrate_mvp_media_to_aws";
import * as backfillLessonSummaries from "./005_backfill_lesson_summaries";
import * as addModelingLifeCourse from "./006_add_modeling_life_course";
import * as repairModelingLifeMedia from "./007_repair_modeling_life_media";

export const dataMigrations: DataMigration[] = [addStoicism, gitDevRdsProbe, addQuintusHoratiusFlaccus, migrateMvpMediaToAws, backfillLessonSummaries];
export { type DataChange, type DataMigration, type DataMigrationContext, type DataMigrationDomain } from "./types";
