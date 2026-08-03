"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Bell,
  ChevronDown,
  FileText,
  MessageCircle,
  Plus,
  Search,
  Trash2,
  Layers,
  ArrowRight,
  Youtube
} from "lucide-react";

const steps = [
  { number: 1, label: "Source Materials", segment: "source-materials" },
  { number: 2, label: "LLM Draft", segment: "llm-draft" },
  { number: 3, label: "Knowledge Wiki", segment: "knowledge-wiki" },
  { number: 4, label: "Publish", segment: "publish" }
];

function activeStep(pathname: string) {
  if (pathname.startsWith("/llm-draft")) return 2;
  if (pathname.includes("/llm-draft")) return 2;
  if (pathname.startsWith("/knowledge-wiki")) return 3;
  if (pathname.includes("/knowledge-wiki")) return 3;
  if (pathname.startsWith("/publish")) return 4;
  if (pathname.includes("/publish")) return 4;
  return 1;
}

function isKnowledgeWorkflowRoute(pathname: string) {
  return (
    pathname.startsWith("/source-materials") ||
    pathname.startsWith("/llm-draft") ||
    pathname.startsWith("/knowledge-wiki") ||
    pathname.startsWith("/publish") ||
    pathname.includes("/source-materials") ||
    pathname.includes("/llm-draft") ||
    pathname.includes("/knowledge-wiki") ||
    pathname.includes("/publish")
  );
}

type Knowledge = { id: string; title: string; status: string };
type Course = { id: string; title: string; knowledge: Knowledge[] };
type NavigationData = {
  courses: Course[];
  counts: { videoCount: number; documentCount: number; qaNotesCount: number };
};

function contextFromPath(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  const knowledgeRoot = parts[0] === "knowledge";
  return {
    courseId: knowledgeRoot ? parts[1] || "philosophy" : "philosophy",
    knowledgeId: knowledgeRoot ? parts[2] || "epicureanism" : "epicureanism",
    isCoursePage: parts[0] === "course",
    selectedCourseId: parts[0] === "course" ? parts[1] || "philosophy" : knowledgeRoot ? parts[1] || "philosophy" : "philosophy"
  };
}

function hrefFor(courseId: string, knowledgeId: string, step: number) {
  const segment = steps.find((item) => item.number === step)?.segment || "source-materials";
  return `/knowledge/${courseId}/${knowledgeId}/${segment}`;
}

function firstKnowledgeTarget(nav: NavigationData) {
  for (const course of nav.courses) {
    const knowledge = course.knowledge[0];
    if (knowledge) return { courseId: course.id, knowledgeId: knowledge.id };
  }
  return null;
}

function hasKnowledgeTarget(nav: NavigationData, courseId: string, knowledgeId: string) {
  return nav.courses.some((course) => course.id === courseId && course.knowledge.some((knowledge) => knowledge.id === knowledgeId));
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const current = activeStep(pathname);
  const showWorkflowStepper = isKnowledgeWorkflowRoute(pathname);
  const context = useMemo(() => contextFromPath(pathname), [pathname]);
  const [nav, setNav] = useState<NavigationData>({
    courses: [
      {
        id: "philosophy",
        title: "Philosophy",
        knowledge: [{ id: "epicureanism", title: "Epicureanism", status: "Draft" }]
      }
    ],
    counts: { videoCount: 0, documentCount: 0, qaNotesCount: 0 }
  });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ philosophy: true });

  async function refreshNavigation() {
    const res = await fetch(`/api/navigation?courseId=${context.courseId}&knowledgeId=${context.knowledgeId}`, { cache: "no-store" });
    const data = await res.json() as NavigationData;
    setNav(data);

    if (showWorkflowStepper && !context.isCoursePage && !hasKnowledgeTarget(data, context.courseId, context.knowledgeId)) {
      const target = firstKnowledgeTarget(data);
      if (target) router.replace(hrefFor(target.courseId, target.knowledgeId, current));
    }
  }

  useEffect(() => { refreshNavigation(); }, [context.courseId, context.knowledgeId]);
  useEffect(() => {
    window.addEventListener("ks:navigation-refresh", refreshNavigation);
    return () => window.removeEventListener("ks:navigation-refresh", refreshNavigation);
  }, [context.courseId, context.knowledgeId]);

  async function createCourse() {
    const title = prompt("Course name");
    if (!title?.trim()) return;
    const res = await fetch("/api/courses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
    if (!res.ok) return alert((await res.json()).error);
    await refreshNavigation();
  }

  async function renameCourse(course: Course) {
    const title = prompt("Rename course", course.title);
    if (!title?.trim() || title === course.title) return;
    const res = await fetch(`/api/courses/${course.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
    if (!res.ok) return alert((await res.json()).error);
    await refreshNavigation();
  }

  async function deleteCourse(course: Course) {
    if (!confirm(`Delete ${course.title} and all of its knowledge pages? This cannot be undone.`)) return;
    await fetch(`/api/courses/${course.id}`, { method: "DELETE" });
    await refreshNavigation();
    router.push("/course/philosophy");
  }

  async function createKnowledge(course: Course) {
    const title = prompt("Knowledge title");
    if (!title?.trim()) return;
    const res = await fetch(`/api/courses/${course.id}/knowledge`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
    if (!res.ok) return alert((await res.json()).error);
    const knowledge = await res.json();
    await refreshNavigation();
    router.push(hrefFor(course.id, knowledge.id, 1));
  }

  async function renameKnowledge(courseId: string, knowledge: Knowledge) {
    const title = prompt("Rename knowledge", knowledge.title);
    if (!title?.trim() || title === knowledge.title) return;
    const res = await fetch(`/api/courses/${courseId}/knowledge/${knowledge.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
    if (!res.ok) return alert((await res.json()).error);
    await refreshNavigation();
  }

  async function deleteKnowledge(courseId: string, knowledge: Knowledge) {
    if (!confirm(`Delete ${knowledge.title}? This cannot be undone.`)) return;
    await fetch(`/api/courses/${courseId}/knowledge/${knowledge.id}`, { method: "DELETE" });
    await refreshNavigation();
    router.push(`/course/${courseId}`);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <img className="logo" src="/knowledge-system-logo.png" alt="Knowledge System" />
          <div>
            <div className="brand-title">Knowledge System</div>
          </div>
        </div>
        {showWorkflowStepper ? (
          <nav className="workflow-stepper" aria-label="Workflow">
            {steps.map((step, index) => (
              <Link className={`workflow-step ${current === step.number ? "active" : ""}`} href={hrefFor(context.courseId, context.knowledgeId, step.number)} key={step.number}>
                <span className="step-number">{step.number}</span>
                <span>{step.label}</span>
                {index < steps.length - 1 ? <ArrowRight className="step-arrow" size={16} /> : null}
              </Link>
            ))}
          </nav>
        ) : null}
        <div className="header-right">
          <label className="top-search">
            <Search size={17} />
            <input aria-label="Search" placeholder="Search anything" />
          </label>
          <div className="top-actions">
            <button className="icon-button top-icon" aria-label="Notifications"><Bell size={18} /></button>
            <div className="profile">
              <img className="avatar" src="/avatar.svg" alt="Prof. Gordon" />
              <div>
                <div className="profile-name">Prof. Gordon <ChevronDown size={13} /></div>
                <div className="profile-role">Subject Expert</div>
              </div>
            </div>
          </div>
        </div>
      </header>
      <div className="body">
        <aside className="sidebar">
          <div className="sidebar-section-label">Where learning lives</div>
          <div className="sidebar-title">
            <span>Course Knowledge Base</span>
            <span className="sidebar-icons"><Search size={24} /><button className="icon-button bare" onClick={createCourse} aria-label="Add course"><Plus size={24} /></button></span>
          </div>
          {nav.courses.map((course) => {
            const courseSelected = context.isCoursePage && context.selectedCourseId === course.id;
            const isExpanded = expanded[course.id] !== false;
            return (
              <div key={course.id}>
                <div className={`tree-row topic ${courseSelected ? "selected" : ""}`} onDoubleClick={() => renameCourse(course)}>
                  <button className="tree-toggle" onClick={() => setExpanded((next) => ({ ...next, [course.id]: !isExpanded }))} aria-label="Toggle course">
                    <ChevronDown size={16} style={{ transform: isExpanded ? "none" : "rotate(-90deg)" }} />
                  </button>
                  <BookOpen size={22} />
                  <span className="row-label" onClick={() => router.push(`/course/${course.id}`)}>{course.title}</span>
                  {courseSelected ? (
                    <span className="row-actions">
                      <button className="icon-button" aria-label="Add knowledge page" onClick={() => createKnowledge(course)}><Plus size={18} /></button>
                      <button className="icon-button danger" aria-label="Delete course" onClick={() => deleteCourse(course)}><Trash2 size={18} /></button>
                    </span>
                  ) : null}
                </div>
                {isExpanded ? course.knowledge.map((knowledge) => {
                  const selected = !context.isCoursePage && context.courseId === course.id && context.knowledgeId === knowledge.id;
                  const knowledgeHref = hrefFor(course.id, knowledge.id, current);
                  return (
                    <div
                      className={`tree-row page ${selected ? "selected" : ""}`}
                      key={knowledge.id}
                      onClick={() => router.push(knowledgeHref)}
                      onDoubleClick={() => renameKnowledge(course.id, knowledge)}
                    >
                      <FileText size={22} />
                      <span className="row-label">{knowledge.title}</span>
                      {selected ? (
                        <button
                          className="icon-button danger"
                          onClick={(event) => {
                            event.stopPropagation();
                            void deleteKnowledge(course.id, knowledge);
                          }}
                          aria-label={`Delete ${knowledge.title}`}
                        >
                          <Trash2 size={18} />
                        </button>
                      ) : null}
                    </div>
                  );
                }) : null}
              </div>
            );
          })}
          <div className="sidebar-divider" />
          <div className="source-heading"><Layers size={22} /> Source Materials</div>
          <div className="source-row"><span className="source-icon"><Youtube size={27} /></span><span>YouTube</span><span className="badge-count">{nav.counts.videoCount}</span></div>
          <div className="source-row"><span className="source-icon"><FileText size={27} /></span><span>Document</span><span className="badge-count">{nav.counts.documentCount}</span></div>
          <div className="source-row"><span className="source-icon qa"><MessageCircle size={27} /></span><span>QA Notes</span><span className="badge-count">{nav.counts.qaNotesCount}</span></div>
          <div className="sidebar-footer-links">
            <span>Changelog</span>
            <span>Beta feature</span>
            <span>Developer Blog</span>
            <span>Roadmap</span>
          </div>
        </aside>
        <main className="main">{children}</main>
      </div>
    </div>
  );
}
