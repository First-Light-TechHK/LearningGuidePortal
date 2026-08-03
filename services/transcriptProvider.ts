import { execFile } from "child_process";
import { promisify } from "util";
import {
  getSourceMaterials,
  transcriptRelativePath,
  updateVideoLink,
  writeTranscriptFile
} from "./sourceMaterialStore";
import { DEFAULT_MODEL_ID } from "./modelStore";
import { resolveModelMaxCompletionTokens } from "./openRouterModelLimits";

const execFileAsync = promisify(execFile);
const TRANSCRIPT_TIMEOUT_MS = 45000;
const OPENROUTER_TIMEOUT_MS = 120000;

export type TranscriptSegment = {
  text: string;
  start: number;
  duration: number;
};

export type AvailableTranscript = {
  language: string;
  languageCode: string;
  isGenerated: boolean;
  isTranslatable: boolean;
};

export type SelectedTranscript = AvailableTranscript & {
  selectionMethod: "manual_available" | "generated_available";
  sourceLanguage?: string;
  sourceLanguageCode?: string;
};

export type TranscriptIntegrity = {
  segmentCount: number;
  fetchedSegmentCount: number;
  emptyTextCount: number;
  monotonicTimestamps: boolean;
  overlapCount: number;
  firstStart: number | null;
  lastEnd: number | null;
  selectedTranscriptListed: boolean;
  complete: boolean;
};

export type TranscriptFetchResult = {
  segments: TranscriptSegment[];
  availableTranscripts: AvailableTranscript[];
  selectedTranscript: SelectedTranscript;
  integrity: TranscriptIntegrity;
};

export type RawTranscript = {
  provider: "youtube-transcript-api";
  videoId: string;
  title: string;
  url: string;
  fetchedAt: string;
  availableTranscripts: AvailableTranscript[];
  selectedTranscript: SelectedTranscript;
  integrity: TranscriptIntegrity;
  segments: TranscriptSegment[];
};

export interface TranscriptProvider {
  fetchTranscript(videoId: string): Promise<TranscriptFetchResult>;
}

const PYTHON_TRANSCRIPT_SCRIPT = String.raw`
import json
import sys

video_id = sys.argv[1]

try:
    from youtube_transcript_api import YouTubeTranscriptApi
except Exception as exc:
    print(json.dumps({"error": "missing_dependency", "detail": str(exc)}))
    sys.exit(2)

def serialise(fetched):
    if hasattr(fetched, "to_raw_data"):
        data = fetched.to_raw_data()
    else:
        data = []
        for item in fetched:
            if hasattr(item, "text"):
                data.append({"text": item.text, "start": item.start, "duration": item.duration})
            else:
                data.append(item)
    return [
        {
            "text": str(item.get("text", "")),
            "start": float(item.get("start", 0)),
            "duration": float(item.get("duration", 0))
        }
        for item in data
    ]

def transcript_meta(transcript, selection_method, source=None):
    payload = {
        "language": getattr(transcript, "language", ""),
        "languageCode": getattr(transcript, "language_code", ""),
        "isGenerated": bool(getattr(transcript, "is_generated", False)),
        "isTranslatable": bool(getattr(transcript, "is_translatable", False)),
        "selectionMethod": selection_method
    }
    if source is not None:
        payload["sourceLanguage"] = getattr(source, "language", "")
        payload["sourceLanguageCode"] = getattr(source, "language_code", "")
    return payload

def available_meta(transcript):
    return {
        "language": getattr(transcript, "language", ""),
        "languageCode": getattr(transcript, "language_code", ""),
        "isGenerated": bool(getattr(transcript, "is_generated", False)),
        "isTranslatable": bool(getattr(transcript, "is_translatable", False))
    }

def select_available_transcript(transcripts):
    manual = [t for t in transcripts if not getattr(t, "is_generated", False)]
    generated = [t for t in transcripts if getattr(t, "is_generated", False)]
    if manual:
        return manual[0], "manual_available"
    if generated:
        return generated[0], "generated_available"
    return None, ""

def integrity(segments, fetched_count, selected, available):
    empty_count = len([item for item in segments if not str(item.get("text", "")).strip()])
    monotonic = True
    overlaps = 0
    previous_start = None
    previous_end = None
    for item in segments:
        start = float(item.get("start", 0))
        duration = float(item.get("duration", 0))
        if previous_start is not None and start < previous_start:
            monotonic = False
        if previous_end is not None and start < previous_end - 0.05:
            overlaps += 1
        previous_start = start
        previous_end = max(start + duration, previous_end or start + duration)
    selected_listed = any(
        item.get("languageCode") == selected.get("languageCode") and item.get("isGenerated") == selected.get("isGenerated")
        for item in available
    )
    first_start = float(segments[0]["start"]) if segments else None
    last_end = max(float(item["start"]) + float(item["duration"]) for item in segments) if segments else None
    complete = bool(segments) and len(segments) == fetched_count and empty_count == 0 and monotonic and selected_listed
    return {
        "segmentCount": len(segments),
        "fetchedSegmentCount": fetched_count,
        "emptyTextCount": empty_count,
        "monotonicTimestamps": monotonic,
        "overlapCount": overlaps,
        "firstStart": first_start,
        "lastEnd": last_end,
        "selectedTranscriptListed": selected_listed,
        "complete": complete
    }

try:
    api = YouTubeTranscriptApi()
    transcript_list = api.list(video_id)
    transcripts = list(transcript_list)
    available = [available_meta(transcript) for transcript in transcripts]
    transcript, selection_method = select_available_transcript(transcripts)
    if transcript is None:
        raise Exception("No transcript is available for this video.")
    fetched = transcript.fetch()
    segments = serialise(fetched)
    selected = transcript_meta(transcript, selection_method)
    print(json.dumps({
        "segments": segments,
        "availableTranscripts": available,
        "selectedTranscript": selected,
        "integrity": integrity(segments, len(segments), selected, available)
    }, ensure_ascii=False))
    sys.exit(0)
except Exception as exc:
    print(json.dumps({"error": "transcript_unavailable", "detail": str(exc)}, ensure_ascii=False))
    sys.exit(1)
`;

export class YouTubeTranscriptApiProvider implements TranscriptProvider {
  async fetchTranscript(videoId: string) {
    const python = process.env.YOUTUBE_TRANSCRIPT_API_PYTHON || "python3";
    const { stdout } = await execFileAsync(python, ["-c", PYTHON_TRANSCRIPT_SCRIPT, videoId], {
      timeout: TRANSCRIPT_TIMEOUT_MS,
      maxBuffer: 20 * 1024 * 1024
    }).catch((error: { stdout?: string; message?: string; code?: number }) => {
      const stdout = error.stdout || "";
      if (stdout) return { stdout };
      throw new Error(error.message || "Transcript not available for this video.");
    });

    const data = JSON.parse(stdout || "{}") as {
      segments?: TranscriptSegment[];
      availableTranscripts?: AvailableTranscript[];
      selectedTranscript?: SelectedTranscript;
      integrity?: TranscriptIntegrity;
      error?: string;
      detail?: string;
    };
    if (data.error === "missing_dependency") {
      throw new Error("youtube-transcript-api is not installed. Install it with: python3 -m pip install youtube-transcript-api");
    }
    if (data.error) throw new Error(data.detail || "Transcript not available for this video.");
    if (!data.segments?.length) throw new Error("Transcript not available for this video.");
    if (!data.selectedTranscript || !data.integrity) throw new Error("Transcript metadata was not returned.");
    if (!data.integrity.complete) throw new Error("Transcript completeness check failed.");
    return {
      segments: data.segments,
      availableTranscripts: data.availableTranscripts || [],
      selectedTranscript: data.selectedTranscript,
      integrity: data.integrity
    };
  }
}

function transcriptPrompt() {
  return [
    "You are a transcript formatter, not a summarizer.",
    "Return ONLY the formatted transcript.",
    "You MUST preserve the transcript text verbatim, word for word.",
    "Do not translate, paraphrase, summarize, correct grammar, normalize wording, add explanations, infer missing text, or omit any transcript words.",
    "Only remove timestamps, merge subtitle fragments into readable lines, and split into appropriate paragraphs.",
    "Remove timestamps.",
    "When merging fragments, keep the original words exactly as written and only change whitespace, line breaks, or paragraph breaks.",
    "Split the result into semantic paragraphs.",
    "Add markdown headings only when the heading text is copied from nearby transcript words or the video title.",
    "Do NOT introduce words that are not present in the transcript except markdown heading markers (#, ##).",
    "If you are tempted to summarize, do not. Output the transcript words instead."
  ].join("\n");
}

function transcriptUserContent(raw: RawTranscript) {
  const lines = raw.segments.map((segment) => {
    const start = Number.isFinite(segment.start) ? segment.start.toFixed(2) : "0.00";
    return `[${start}s] ${segment.text}`;
  });
  return [
    `Video title: ${raw.title}`,
    `Video URL: ${raw.url}`,
    `Selected transcript: ${raw.selectedTranscript.language} (${raw.selectedTranscript.languageCode}), generated=${raw.selectedTranscript.isGenerated}, method=${raw.selectedTranscript.selectionMethod}`,
    `Completeness check: ${raw.integrity.complete ? "passed" : "failed"}, segments=${raw.integrity.segmentCount}, firstStart=${raw.integrity.firstStart}, lastEnd=${raw.integrity.lastEnd}`,
    "Transcript with timestamps. The text after each timestamp must be preserved exactly:",
    lines.join("\n")
  ].join("\n\n");
}

function stripCodeFence(value: string) {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/i);
  return (match ? match[1] : trimmed).trim();
}

function normaliseForTranscriptCheck(value: string) {
  return value
    .replace(/[#*_`>\-[\]().,:;!?'"“”‘’]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function transcriptPreservationScore(raw: RawTranscript, output: string) {
  const outputText = normaliseForTranscriptCheck(output);
  if (!outputText || /^based on the transcript|.*\bsummary\b/i.test(output.slice(0, 200))) return 0;
  const chunks = raw.segments
    .map((segment) => normaliseForTranscriptCheck(segment.text))
    .filter((text) => text.length > 18);
  if (!chunks.length) return 0;
  const preserved = chunks.filter((chunk) => outputText.includes(chunk)).length;
  return preserved / chunks.length;
}

function buildDeterministicSemanticTranscript(raw: RawTranscript) {
  const paragraphs: string[] = [];
  let current: string[] = [];
  let previousEnd: number | null = null;

  for (const segment of raw.segments) {
    const text = segment.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const gap = previousEnd === null ? 0 : segment.start - previousEnd;
    if (current.length && gap > 2.2) {
      paragraphs.push(current.join(" "));
      current = [];
    }
    current.push(text);
    previousEnd = segment.start + segment.duration;
  }
  if (current.length) paragraphs.push(current.join(" "));

  return [`# ${raw.title}`, ...paragraphs].join("\n\n").trim();
}

async function generateSemanticTranscript(raw: RawTranscript) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OpenRouter API key is missing. Please set OPENROUTER_API_KEY.");

  const limit = resolveModelMaxCompletionTokens({ model: DEFAULT_MODEL_ID, generationType: "full" });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "http://localhost:3000",
        "X-Title": process.env.OPENROUTER_APP_NAME || "Knowledge System"
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL_ID,
        temperature: 0.1,
        messages: [
          { role: "system", content: transcriptPrompt() },
          { role: "user", content: transcriptUserContent(raw) }
        ],
        max_completion_tokens: limit.maxCompletionTokens
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenRouter request failed: ${response.status} ${text.slice(0, 300)}`);
    }

    const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const output = stripCodeFence(data.choices?.[0]?.message?.content || "");
    if (!output) throw new Error("OpenRouter returned an empty semantic transcript.");
    const score = transcriptPreservationScore(raw, output);
    if (score < 0.82) return buildDeterministicSemanticTranscript(raw);
    return output;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("OpenRouter request timed out while generating the semantic transcript.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function parseVideoTranscript(courseId: string, knowledgeId: string, videoLinkId: string) {
  const provider = new YouTubeTranscriptApiProvider();
  const manifest = await getSourceMaterials(courseId, knowledgeId);
  const video = manifest.videos.find((item) => item.id === videoLinkId);
  if (!video) throw new Error("YouTube link not found");

  await updateVideoLink(courseId, knowledgeId, video.id, {
    transcriptStatus: "downloading",
    transcriptError: undefined
  });

  let rawTranscript: RawTranscript;
  try {
    const transcript = await provider.fetchTranscript(video.videoId);
    rawTranscript = {
      provider: "youtube-transcript-api",
      videoId: video.videoId,
      title: video.title,
      url: video.url,
      fetchedAt: new Date().toISOString(),
      availableTranscripts: transcript.availableTranscripts,
      selectedTranscript: transcript.selectedTranscript,
      integrity: transcript.integrity,
      segments: transcript.segments
    };
  } catch (error) {
    await updateVideoLink(courseId, knowledgeId, video.id, {
      transcriptStatus: "error",
      transcriptError: error instanceof Error ? error.message : "Transcript not available for this video."
    });
    throw error;
  }

  await updateVideoLink(courseId, knowledgeId, video.id, { transcriptStatus: "saving" });
  const rawPath = transcriptRelativePath("raw", video.title);
  await writeTranscriptFile(courseId, knowledgeId, rawPath, `${JSON.stringify(rawTranscript, null, 2)}\n`);
  await updateVideoLink(courseId, knowledgeId, video.id, {
    transcriptStatus: "generating",
    rawTranscriptPath: rawPath
  });

  try {
    const semanticTranscript = await generateSemanticTranscript(rawTranscript);
    const semanticPath = transcriptRelativePath("semantic", video.title);
    await updateVideoLink(courseId, knowledgeId, video.id, { transcriptStatus: "saving" });
    await writeTranscriptFile(courseId, knowledgeId, semanticPath, `${semanticTranscript}\n`);
    return updateVideoLink(courseId, knowledgeId, video.id, {
      transcriptStatus: "ready",
      rawTranscriptPath: rawPath,
      semanticTranscriptPath: semanticPath,
      transcriptError: undefined
    });
  } catch (error) {
    return updateVideoLink(courseId, knowledgeId, video.id, {
      transcriptStatus: "error",
      rawTranscriptPath: rawPath,
      transcriptError: error instanceof Error ? error.message : "OpenRouter failed while generating semantic transcript."
    });
  }
}
