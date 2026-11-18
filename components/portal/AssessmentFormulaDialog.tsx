"use client";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import type { MathfieldElement } from "mathlive";
import { PortalDialog } from "./PortalDialog";
import "mathlive/fonts.css";
import dialogStyles from "./portal-dialog.module.css";
import styles from "./assessment-answer-input.module.css";

export function AssessmentFormulaDialog({ latex, block, locale, onApply, onClose }: { latex: string; block: boolean; locale: Locale; onApply: (latex: string, block: boolean) => boolean; onClose: () => void }) {
  const editorCopy = getMessages(locale).assessmentEditor;
  const [host, setHost] = useState<HTMLDivElement | null>(null), [keyboardHost, setKeyboardHost] = useState<HTMLDivElement | null>(null);
  const field = useRef<MathfieldElement | null>(null), close = useRef(onClose);
  close.current = onClose;
  const [ready, setReady] = useState(false);
  const [source, setSource] = useState(latex), [display, setDisplay] = useState(block), [error, setError] = useState("");
  useEffect(() => {
    // Portal children mount after the parent effect, including when the import is cached.
    if (!host || !keyboardHost) return;
    setReady(false);
    let disposed = false;
    let cleanup = () => {};
    void import("mathlive").then(({ MathfieldElement }) => {
      if (disposed) return;
      MathfieldElement.fontsDirectory = null;
      MathfieldElement.soundsDirectory = null;
      const mf = new MathfieldElement();
      mf.value = latex; mf.mathVirtualKeyboardPolicy = "manual";
      mf.setAttribute("aria-label", editorCopy.equationEditor);
      mf.addEventListener("input", () => setSource(mf.value));
      const keyboard = window.mathVirtualKeyboard, previous = keyboard.container;
      keyboard.container = keyboardHost;
      const resizeKeyboard = () => { keyboardHost.style.height = `${keyboard.boundingRect.height}px`; };
      keyboard.addEventListener("geometrychange", resizeKeyboard);
      const dialog = host.closest("dialog");
      const escape = (event: KeyboardEvent) => {
        if (event.key !== "Escape") return;
        event.preventDefault(); event.stopPropagation(); close.current();
      };
      dialog?.addEventListener("keydown", escape, true);
      // Disconnect the field before restoring the global keyboard container, without animations.
      cleanup = () => {
        dialog?.removeEventListener("keydown", escape, true);
        keyboard.removeEventListener("geometrychange", resizeKeyboard);
        mf.blur(); mf.remove(); field.current = null;
        keyboard.hide({ animate: false }); keyboard.container = previous;
      };
      host.append(mf); field.current = mf; mf.focus(); setReady(true);
    }).catch(() => { if (!disposed) setError(editorCopy.unableToLoadTheEquationEditor); });
    return () => { disposed = true; cleanup(); };
  }, [editorCopy, latex, host, keyboardHost]);
  const templates = [["a/b", "\\frac{\\placeholder{}}{\\placeholder{}}"], ["x²", "x^{\\placeholder{}}"], ["xₙ", "x_{\\placeholder{}}"], ["√", "\\sqrt{\\placeholder{}}"], ["Σ", "\\sum_{n=1}^{\\placeholder{}}"], ["∫", "\\int_{0}^{1}\\placeholder{}\\,dx"], ["α β", "\\alpha"], ["2×2", "\\begin{pmatrix}\\placeholder{}&\\placeholder{}\\\\\\placeholder{}&\\placeholder{}\\end{pmatrix}"]];
  return <PortalDialog portal className={`${dialogStyles.dialog} ${styles.formulaDialog}`} labelledBy="formula-title" onClose={onClose}>
    <h2 id="formula-title">{editorCopy.insertEquation}</h2>
    <p>{editorCopy.chooseATemplateAndFillIn}</p>
    <div className={styles.templates}>{templates.map(([label, tex]) => <button type="button" key={label} disabled={!ready} onClick={() => { field.current?.insert(tex); field.current?.focus(); }}>{label}</button>)}<button type="button" disabled={!ready} onClick={() => window.mathVirtualKeyboard?.show()}>{editorCopy.mathKeyboard}</button></div>
    <div ref={setHost} className={styles.mathfield}/>
    <label><input type="checkbox" checked={display} onChange={e => setDisplay(e.target.checked)}/>{editorCopy.separateLine}</label>
    <details><summary>LaTeX</summary><textarea aria-label="LaTeX" value={source} onChange={e => { setSource(e.target.value); if (field.current) field.current.value = e.target.value; }}/></details>
    <div ref={setKeyboardHost} className={styles.keyboard}/>
    <p role="status">{error || (editorCopy.equationChangesHaveNotBeenApplied)}</p>
    <footer><button type="button" onClick={onClose}>{editorCopy.cancel}</button><button type="button" disabled={!ready || !source.trim()} onClick={() => { if (!onApply(source, display)) setError(editorCopy.theEquationCannotBeRenderedOr); }}>{editorCopy.apply}</button></footer>
  </PortalDialog>;
}
