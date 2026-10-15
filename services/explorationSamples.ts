import type { ExplorationDisplay } from "@/contracts/exploration";
import type { Locale } from "@/lib/i18n/config";

/** Course-scoped display samples; never persisted as published course content. */
export function explorationSamples(locale:Locale, courseId:string, lessonNumber="01"):ExplorationDisplay {
  const zh=locale==="zh-CN";
  const readings=[
    ["book","Ways of Seeing","John Berger · 1972",zh?"介绍文化背景如何影响我们解读视觉图像的基础读物。":"A foundational introduction to how cultural context shapes the way we interpret visual images."],
    ["article","The Art of Looking Sideways","Alan Fletcher · Design and observation",zh?"通过一系列视觉创意，激发好奇心、专注力和意想不到的联系。":"A collection of visual ideas that encourages curiosity, attention and unexpected connections."],
    ["book","On Looking","Alexandra Horowitz · 2013",zh?"探讨有意识的关注如何揭示通常被忽略的细节。":"Explores how deliberate attention can reveal details that usually remain unnoticed."],
    ["article","Learning to Look at Art","Museum Education Review",zh?"提供放慢节奏、仔细观察并形成独立解读的实用方法。":"Practical approaches for slowing down, observing carefully and forming an independent interpretation."]
  ];
  const titles=zh?["花园构图","视觉平衡","种植韵律","路径与视角","季节色彩"]:["Garden composition","Visual balance","Planting rhythm","Path and viewpoint","Seasonal colour"];
  const types=["image","video","model3d","image","image"] as const;
  const urls=["/portal/exh2.jpg","/portal/text-exhibits/flowers.webm","/portal/text-exhibits/vase.obj","/portal/exh.jpg","/portal/exh2.jpg"];
  return {
    readings:readings.map(([kind,title,author,description],index)=>({id:`${courseId}-reading-${index}`,kind:kind as "book"|"article",title,author,description,lessonNumber})),
    exhibits:titles.map((title,index)=>({node:{id:`${courseId}-exhibit-${index}`,title,type:types[index],url:urls[index],triggerTime:0},lessonNumber,thumbnail:"/portal/exploration/thumbnail-v2.png"}))
  };
}
