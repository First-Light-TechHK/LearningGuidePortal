import type { ProductCourse } from "./productStore";
import type { OverviewDesignSample } from "@/contracts/overview-design-sample";

/** Figma 99:41 display samples; destinations still use published course identities. */
export function overviewDesignSample(courses: ProductCourse[]): OverviewDesignSample {
  const published = courses.filter(course => course.status === "published");
  const samples: OverviewDesignSample["courses"] = [
    {id:"sample-art",title:"The Art of Seeing",category:"chinese",cover:"/portal/overview-v1/art.png",lessonCount:12,currentLesson:4,progress:46,mode:"video",action:"resume",courseId:null,lessonId:null},
    {id:"sample-history",title:"Tang Dynasty History",category:"science",cover:"/portal/overview-v1/history.png",lessonCount:10,currentLesson:null,progress:100,mode:"text",action:"review",courseId:null,lessonId:null},
    {id:"sample-nature",title:"The Logic of Nature",category:"european",cover:"/portal/overview-v1/nature.png",lessonCount:8,currentLesson:1,progress:10,mode:"text",action:"plans",courseId:null,lessonId:null},
  ];
  return {name:"Macai",courses:samples.map((sample,index)=>({...sample,courseId:published[index]?.id || null,lessonId:published[index]?.sections.flatMap(section=>section.lessons)[0]?.id || null}))};
}
