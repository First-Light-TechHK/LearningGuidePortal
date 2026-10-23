import type { LessonNode } from "./lesson-content";
export interface ExplorationLesson { number:string; title:string; unlocked:boolean }
export interface ExplorationReading { id:string; kind:"book"|"article"; title:string; author:string; description:string; lessonNumber:string }
export interface ExplorationExhibit { node:LessonNode; lessonNumber:string; thumbnail:string }
export interface ExplorationDisplay { readings:ExplorationReading[]; exhibits:ExplorationExhibit[] }
