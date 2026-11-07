"use client";

import { Form, Input, Select } from "antd";
import { useState } from "react";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { clampGroupAbout, GROUP_ABOUT_MAX } from "./studyGroupClient";
import { PortalProvider } from "./ui/PortalProvider";
import { PortalButton } from "./ui/PortalButton";
import styles from "./create-study-group-form.module.css";

type GroupFields = { title: string; courseId: string; about: string };

export function CreateStudyGroupForm({ locale, courses, creating, error, className, onCancel, onInvalid, onSubmit }: {
  locale: Locale; courses: Array<{ id: string; title: string }> | null;
  creating: boolean; error?: string; className?: string;
  onCancel: () => void; onInvalid: () => void; onSubmit: (form: FormData) => Promise<void>;
}) {
  const copy = getMessages(locale).studyGroupsPage;
  const [courseOpen, setCourseOpen] = useState(false);
  const noCourses = courses !== null && courses.length === 0;
  return <PortalProvider locale={locale}>
    <div className={`${className || ""} ${styles.panel}`} style={{ padding: "var(--create-group-padding, 30px)" }}>
    <Form<GroupFields> className={styles.form} layout="vertical" requiredMark disabled={creating}
      onFinish={values => {
        if (creating || noCourses) return;
        const data = new FormData();
        data.set("title", values.title); data.set("courseId", values.courseId); data.set("about", values.about);
        void onSubmit(data);
      }} onFinishFailed={onInvalid}>
      <h2 id="study-group-dialog-title">{copy.create}</h2>
      <p className={styles.lead}>{copy.createLead}</p>
      <Form.Item name="title" label={copy.groupTitle} normalize={(value: string) => value.slice(0, 50)} rules={[{ required: true, whitespace: true, message: copy.errors.validation }]}>
        <Input name="title" maxLength={50} showCount placeholder={copy.enterTitle} autoComplete="off"/>
      </Form.Item>
      <Form.Item name="courseId" label={copy.relatedCourse} rules={[{ required: true, message: copy.errors.validation }]}>
        <Select placeholder={copy.selectCourse} loading={courses === null} disabled={creating || noCourses || courses === null}
          open={courseOpen} onOpenChange={setCourseOpen} onInputKeyDown={event => {
            if (event.key === "Escape" && courseOpen) {
              event.preventDefault(); event.stopPropagation(); setCourseOpen(false);
            }
          }}
          options={(courses || []).map(course => ({ value: course.id, label: course.title }))}
          getPopupContainer={trigger => trigger.closest("dialog") || trigger.parentElement!}/>
      </Form.Item>
      {noCourses && <p className={styles.noCourses}>{copy.noCourseAccess} <a href={`/${locale}/portal/courses`}>{copy.viewCourses}</a></p>}
      <Form.Item name="about" label={copy.about} normalize={clampGroupAbout} rules={[{ required: true, whitespace: true, message: copy.errors.validation }]}>
        <Input.TextArea name="about" maxLength={GROUP_ABOUT_MAX} showCount placeholder={copy.enterDescription} autoSize={{ minRows: 4, maxRows: 7 }}/>
      </Form.Item>
      <div className={styles.actions}>
        <PortalButton onClick={onCancel} disabled={creating}>{copy.cancel}</PortalButton>
        <PortalButton type="primary" htmlType="submit" loading={creating} disabled={creating || noCourses || courses === null}>{copy.create}</PortalButton>
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
    </Form>
    </div>
  </PortalProvider>;
}
