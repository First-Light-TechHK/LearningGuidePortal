import assert from "node:assert/strict";
import React,{createElement} from "react";
import {renderToStaticMarkup}from"react-dom/server";
import {test}from"node:test";
import{TutorAnswer}from"../../components/portal/TutorAnswer";
import{tutorAnswerSegments}from"../../lib/tutorAnswer";
(globalThis as {React?:typeof React}).React=React;
const render=(text:string)=>renderToStaticMarkup(createElement(TutorAnswer,{text,sourcesLabel:"Sources"}));
test("historical overescaped feedback renders fractions and equations without rewriting the input",()=>{
 const text=String.raw`正确给出了比例，即鹰占 \\(\\frac{2}{3}\\)，鸽子占 \\(\\frac{1}{3}\\)。等式为 \\(2 - 2.5x = 1 - x\\)。`;
 const before=JSON.stringify(text),html=render(text);assert.equal((html.match(/class="katex"/g)||[]).length,3);assert.equal(html.includes("katex-error"),false);assert.equal(JSON.stringify(text),before);
});
test("normal and fully escaped matrices preserve their row separators",()=>{
 const tex=String.raw`\begin{pmatrix}1&2\\3&4\end{pmatrix}`;
 for(const text of [String.raw`\[${tex}\]`,String.raw`\\[${tex}\\]`,String.raw`\\[${tex.replace(/\\/g,"\\\\")}\\]`]){
  const math=tutorAnswerSegments(text).segments.find(s=>s.kind==="math");assert.ok(math&&math.kind==="math");assert.equal(math.tex,tex);const html=render(text);assert.ok(html.includes('class="katex"'));assert.equal(html.includes("katex-error"),false);
 }
});
test("code, currency and ordinary TeX line breaks remain literal or unchanged",()=>{
 const code=String.raw`\\(\\frac{2}{3}\\)`;
 const html=render('`'+code+'`');assert.ok(html.includes('<code>'));assert.equal(html.includes('class="katex"'),false);
 assert.equal(render(String.raw`价格 \$5 和 \$10`).includes('class="katex"'),false);
 const tex=String.raw`a\\b`;const segment=tutorAnswerSegments(String.raw`\(${tex}\)`).segments[0];assert.ok(segment.kind==="math");assert.equal(segment.tex,tex);
});
