import assert from "node:assert/strict";
import { test } from "node:test";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Mathematics } from "@tiptap/extension-mathematics";
import { answerDocument, documentAnswer, needsAnswerSource } from "../../lib/assessmentAnswerDocument";

const schema=getSchema([StarterKit,Mathematics]);
const samples=["", " ","\n\n\n","中文🙂👨‍👩‍👧‍👦", "x".repeat(1999),"x".repeat(2000),"x".repeat(2001),"🙂".repeat(1000),"\uFFFC0\uFFFC","\uFFFC9999\uFFFC", "$5 and $10", String.raw`\$5`, String.raw`$x$`,String.raw`$a\$b$`,String.raw`$\text{cost \$5}$`,String.raw`\(x^2\)`,String.raw`before $$x^2$$ after`,"  \\[x^2\\]  \r\n", "$$\n\\begin{matrix}1&2\\\\3&4\\end{matrix}\n$$", String.raw`\frac{1}{2}`,String.raw`\frac{1}{2} is the answer`,String.raw`\frac{`,String.raw`\unknowncommand{x}`,String.raw`\(\href{javascript:alert(1)}{x}\)`,"`$x$`", "**Bold**\n\\(x^2\\)","|A|B|\n|-|-|", "a\tb\r\nc","\\(x\\","$", "$$", "\\(", "\\[", "a\u0000b"];
for(const [index,source] of samples.entries())test(`answer boundary ${index}: ${JSON.stringify(source.slice(0,48))}`,()=>{
  const doc=answerDocument(source);schema.nodeFromJSON(doc).check();assert.equal(documentAnswer(doc),source);assert.equal(typeof needsAnswerSource(source),"boolean");
});
test("escaped dollar is part of the complete formula, not a closing delimiter",()=>{
 const doc=answerDocument(String.raw`$a\$b$`);assert.equal(doc.content![0].content![0].attrs!.latex,String.raw`a\$b`);
});
test("prose after a bare formula remains prose",()=>{assert.equal(answerDocument(String.raw`\frac{1}{2} is the answer`).content![0].type,"paragraph");});
test("1000 deterministic round-trip and valid-schema samples",()=>{
 let seed=42;const chars=["a","2","$","\\","(",")","[","]","{","}","\n","\r"," ","\uFFFC","0","9","🙂","中"];
 for(let i=0;i<1000;i++){
  let source="";for(let j=0;j<30;j++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;source+=chars[seed%chars.length];}
  const doc=answerDocument(source);assert.equal(documentAnswer(doc),source,JSON.stringify(source));schema.nodeFromJSON(doc).check();
 }
});
