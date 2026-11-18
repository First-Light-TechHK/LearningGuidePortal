"use client";
import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import { Slice } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { InlineMath, BlockMath } from "@tiptap/extension-mathematics";
import dynamic from "next/dynamic";
import katex from "katex";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { answerDocument, documentAnswer, needsAnswerSource } from "@/lib/assessmentAnswerDocument";
import { TutorAnswer } from "./TutorAnswer";
import styles from "./assessment-answer-input.module.css";

const FormulaDialog = dynamic(() => import("./AssessmentFormulaDialog").then(m => m.AssessmentFormulaDialog), { ssr: false });
const OriginalMath = Extension.create({ name: "originalMath", addGlobalAttributes() { return [{ types: ["inlineMath", "blockMath"], attributes: { originalLatex: { default: null, rendered: false }, originalSource: { default: null, rendered: false } } }]; } });
export function AssessmentText({ text, locale }: { text: string; locale: Locale }) {
  return <TutorAnswer text={text} sourcesLabel={getMessages(locale).applicationAssessment.sources}/>;
}
export function AssessmentAnswerInput({ id, locale, value, onChange, maxLength, placeholder, readOnly, className }: {
  id: string; locale: Locale; value: string; onChange: (value: string) => void; maxLength: number;
  placeholder: string; readOnly?: boolean; className?: string;
}) {
  const editorCopy = getMessages(locale).assessmentEditor;
  const copy = getMessages(locale).applicationAssessment;
  const sourceRequired = needsAnswerSource(value);
  const [sourceMode, setSourceMode] = useState(() => needsAnswerSource(value));
  const [formula, setFormula] = useState<{ latex: string; block: boolean; pos?: number } | null>(null), [error, setError] = useState("");
  const latest = useRef({ value, onChange, maxLength, readOnly }); latest.current = { value, onChange, maxLength, readOnly };
  const sourceField = useRef<HTMLTextAreaElement>(null), selection = useRef({ from: 0, to: 0 });
  const editor = useEditor({ immediatelyRender: false, extensions: [StarterKit.configure({ bold: false, italic: false, strike: false, code: false, codeBlock: false, heading: false, bulletList: false, orderedList: false, blockquote: false, horizontalRule: false, link: false, underline: false }), OriginalMath,
    InlineMath.configure({ katexOptions: { trust: false, maxExpand: 100 }, onClick: (node, pos) => { if (!latest.current.readOnly) setFormula({ latex: node.attrs.latex, block: false, pos }); } }),
    BlockMath.configure({ katexOptions: { trust: false, maxExpand: 100 }, onClick: (node, pos) => { if (!latest.current.readOnly) setFormula({ latex: node.attrs.latex, block: true, pos }); } })],
    content: answerDocument(value), editable: !readOnly,
    editorProps: { attributes: { id, role: "textbox", "aria-multiline": "true", "aria-readonly": String(Boolean(readOnly)), "aria-label": copy.edit, "data-placeholder": placeholder }, transformPastedText: text => text,
      handlePaste: (view, event) => {
        const text = event.clipboardData?.getData("text/plain") || "";
        if (latest.current.readOnly || needsAnswerSource(text)) return false;
        const doc = view.state.schema.nodeFromJSON(answerDocument(text));
        let hasMath = false;
        doc.descendants(node => { if (node.type.name === "inlineMath" || node.type.name === "blockMath") hasMath = true; });
        if (!hasMath) return false;
        const transaction = view.state.tr.replaceSelection(Slice.maxOpen(doc.content));
        if (documentAnswer(transaction.doc.toJSON()).length > latest.current.maxLength) { setError(editorCopy.answerExceedsTheLengthLimit); return true; }
        view.dispatch(transaction.scrollIntoView());
        return true;
      }
    },
    onUpdate: ({ editor }) => {
      const next = documentAnswer(editor.getJSON());
      if (next === latest.current.value) return;
      if (next.length > latest.current.maxLength) { editor.commands.setContent(answerDocument(latest.current.value), { emitUpdate: false }); setError(editorCopy.answerExceedsTheLengthLimit); return; }
      setError(""); latest.current.onChange(next);
    }
  });
  useEffect(() => { editor?.setEditable(!readOnly, false); if (readOnly) setFormula(null); }, [editor, readOnly]);
  useEffect(() => {
    if (editor && documentAnswer(editor.getJSON()) !== value) editor.commands.setContent(answerDocument(value), { emitUpdate: false });
    if (needsAnswerSource(value)) setSourceMode(true);
  }, [editor, value]);
  function insert() {
    if (sourceMode) selection.current = { from: sourceField.current?.selectionStart || 0, to: sourceField.current?.selectionEnd || 0 };
    else if (editor) selection.current = { from: editor.state.selection.from, to: editor.state.selection.to };
    setFormula({ latex: "", block: false });
  }
  function apply(latex: string, block: boolean) {
    try { katex.renderToString(latex, { throwOnError: true, trust: false, maxExpand: 100 }); } catch { return false; }
    if (readOnly) return false;
    if (sourceMode) {
      const { from, to } = selection.current, insertion = block ? `\n\\[${latex}\\]\n` : `\\(${latex}\\)`;
      const next = value.slice(0, from) + insertion + value.slice(to);
      if (next.length > maxLength) return false;
      onChange(next);
    } else if (editor) {
      const node = { type: block ? "blockMath" : "inlineMath", attrs: { latex } };
      const transaction = editor.state.tr;
      if (formula?.pos !== undefined) {
        const old = editor.state.doc.nodeAt(formula.pos);
        if (!old || (old.type.name !== "inlineMath" && old.type.name !== "blockMath")) return false;
        if (block !== formula.block) transaction.replaceRangeWith(formula.pos, formula.pos + old.nodeSize, editor.schema.nodeFromJSON(node));
        else transaction.setNodeMarkup(formula.pos, undefined, { latex });
      } else transaction.replaceRangeWith(selection.current.from, selection.current.to, editor.schema.nodeFromJSON(node));
      if (documentAnswer(transaction.doc.toJSON()).length > maxLength) return false;
      editor.view.dispatch(transaction); editor.commands.focus();
    } else return false;
    setFormula(null); return true;
  }
  return <div className={`${className || ""} ${styles.editor}`}>
    <div className={styles.tools}>
      <button type="button" disabled={readOnly} onClick={insert}>{copy.formula}</button>
      <button type="button" role="switch" className={styles.sourceSwitch} aria-checked={sourceMode} aria-describedby={sourceRequired ? `${id}-source-help` : undefined} disabled={sourceMode && sourceRequired} onClick={() => setSourceMode(!sourceMode)}>
        <span>{editorCopy.sourceMode}</span><span className={styles.switchTrack} aria-hidden="true"><span/></span>
      </button>
    </div>
    {sourceRequired && <p id={`${id}-source-help`} className={styles.sourceHelp}>{editorCopy.sourceRequired}</p>}
    {sourceMode ? <textarea ref={sourceField} id={id} aria-label={copy.edit} value={value} maxLength={maxLength} placeholder={placeholder} readOnly={readOnly} onChange={event => onChange(event.target.value)}/> : <EditorContent editor={editor} className={styles.surface}/>}
    {error && <p role="alert">{error}</p>}
    {formula && <FormulaDialog latex={formula.latex} block={formula.block} locale={locale} onApply={apply} onClose={() => setFormula(null)}/>}
  </div>;
}
