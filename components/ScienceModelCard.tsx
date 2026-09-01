"use client";

import { useEffect, useRef, useState } from "react";
import { scienceModelForKnowledge } from "@/services/scienceModels";

type ModelParams = Record<string, number>;

type ModelMessage = {
  source?: string;
  topic?: string;
  summary?: string;
  params?: ModelParams;
};

function sameParams(a?: ModelParams, b?: ModelParams) {
  return JSON.stringify(a || {}) === JSON.stringify(b || {});
}

export function ScienceModelCard({
  knowledgeId,
  onState
}: {
  knowledgeId: string;
  onState?: (summary: string) => void;
}) {
  const spec = scienceModelForKnowledge(knowledgeId);
  const modelSpec = spec;
  const compactRef = useRef<HTMLIFrameElement | null>(null);
  const popupRef = useRef<HTMLIFrameElement | null>(null);
  const onStateRef = useRef(onState);
  const paramsRef = useRef<ModelParams>({});
  const [summary, setSummary] = useState(modelSpec?.defaultSummary || "");
  const [open, setOpen] = useState(false);
  onStateRef.current = onState;

  useEffect(() => {
    if (!modelSpec) {
      onStateRef.current?.("");
      return;
    }
    const expectedTopic = modelSpec.knowledgeId;
    setSummary(modelSpec.defaultSummary);
    onStateRef.current?.(modelSpec.defaultSummary);
    function onMessage(event: MessageEvent<ModelMessage>) {
      if (event.data?.source !== "science-model") return;
      if (event.data.topic && event.data.topic !== expectedTopic) return;
      const next = String(event.data.summary || "").trim();
      if (next) {
        setSummary(next);
        onStateRef.current?.(next);
      }
      const params = event.data.params || {};
      if (sameParams(paramsRef.current, params)) return;
      paramsRef.current = params;
      const source = event.source;
      const compactWin = compactRef.current?.contentWindow;
      const popupWin = popupRef.current?.contentWindow;
      const target = source === compactWin ? popupWin : source === popupWin ? compactWin : null;
      target?.postMessage({ type: "science-model-set", params }, "*");
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [knowledgeId, modelSpec]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!modelSpec) return null;

  function run(which: "compact" | "popup") {
    const frame = which === "popup" ? popupRef.current : compactRef.current;
    frame?.contentWindow?.postMessage({ type: "science-model-run" }, "*");
  }

  function onPopupLoad() {
    popupRef.current?.contentWindow?.postMessage({ type: "science-model-set", params: paramsRef.current }, "*");
  }

  return (
    <>
      <section className="science-model-card" aria-label={spec.title}>
        <header>
          <div>
        <strong>{modelSpec.title}</strong>
            <p>Change a quantity, or run the example. Open the example for the contrast cases.</p>
          </div>
          <div className="science-model-actions">
            <button type="button" className="btn" onClick={() => setOpen(true)}>Open example</button>
            <button type="button" className="btn primary" onClick={() => run("compact")}>Run</button>
          </div>
        </header>
        <iframe
          ref={compactRef}
          title={modelSpec.title}
          src={`${modelSpec.src}?mode=compact`}
          sandbox="allow-scripts"
          className="science-model-frame"
        />
        <p className="science-model-summary">{summary}</p>
      </section>
      {open ? (
        <div
          className="modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div className="modal-card science-model-modal" role="dialog" aria-modal="true" aria-label={spec.title}>
            <div className="science-model-modal-head">
              <div>
            <h2>{modelSpec.title}</h2>
                <p>Same quantities as the card. The cases are contrasts, not a second model.</p>
              </div>
              <div className="science-model-actions">
                <button type="button" className="btn primary" onClick={() => run("popup")}>Run</button>
                <button type="button" className="btn" onClick={() => setOpen(false)}>Close</button>
              </div>
            </div>
            <iframe
              ref={popupRef}
            title={`${modelSpec.title} example`}
            src={`${modelSpec.src}?mode=full`}
              sandbox="allow-scripts"
              className="science-model-modal-frame"
              onLoad={onPopupLoad}
            />
            <p className="science-model-summary">{summary}</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
