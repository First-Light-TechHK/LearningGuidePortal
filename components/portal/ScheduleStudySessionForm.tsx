"use client";

import { Col, ConfigProvider, DatePicker, Form, Input, Row, Select, Switch, TimePicker, Tooltip } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import "dayjs/locale/en-gb";
import "dayjs/locale/zh-cn";
import { Info } from "lucide-react";
import { useState } from "react";
import type { Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { DURATION_MINUTE_CHOICES, fill, SESSION_FOCUS_MAX, SESSION_TITLE_MAX } from "./studyGroupClient";
import { PortalProvider } from "./ui/PortalProvider";
import { PortalButton } from "./ui/PortalButton";
import shared from "./create-study-group-form.module.css";
import layout from "./study-groups.module.css";

type SessionFields = {
  title: string; lesson?: string; date: Dayjs; time: Dayjs;
  durationMinutes: number; maxParticipants: number; focus?: string; aiTutor: boolean;
};

export function ScheduleStudySessionForm({ locale, group, busy, error, onCancel, onInvalid, onSubmit }: {
  locale: Locale;
  group: { title: string; about: string; tutorOnline?: boolean; lessons?: Array<{ id: string; title: string }> };
  busy: boolean; error?: string; onCancel: () => void;
  onInvalid: (problem: "validation" | "start_in_past") => void;
  onSubmit: (data: FormData) => Promise<void>;
}) {
  const copy = getMessages(locale).studyGroupsPage;
  const [form] = Form.useForm<SessionFields>();
  const selectedDate: Dayjs | undefined = Form.useWatch("date", form);
  const [popup, setPopup] = useState<string | null>(null);
  const tutorOffline = group.tutorOnline === false;
  const required = { required: true, message: copy.errors.validation };
  const popupContainer = (trigger: HTMLElement) => trigger.closest("dialog") || trigger.parentElement!;
  const popupChange = (name: string, open: boolean) => setPopup(current => open ? name : current === name ? null : current);
  return <PortalProvider locale={locale}>
    <ConfigProvider theme={{ token: { fontSize: 12, controlHeight: 42 } }}>
    <div className={shared.panel} style={{ width: "min(540px, 100%)", padding: "var(--create-group-padding, 30px)" }}>
      <Form<SessionFields> form={form} className={shared.form} layout="vertical" disabled={busy} initialValues={{ aiTutor: !tutorOffline }}
        onKeyDownCapture={event => {
          if (event.key === "Escape" && popup) { event.preventDefault(); event.stopPropagation(); setPopup(null); }
        }} onFinishFailed={() => onInvalid("validation")} onFinish={values => {
          if (busy) return;
          // Preserve the existing local-date/time payload and reject elapsed start times.
          const date = values.date.format("YYYY-MM-DD"), time = values.time.format("HH:mm");
          if (new Date(`${date}T${time}`).getTime() <= Date.now()) { onInvalid("start_in_past"); return; }
          const data = new FormData();
          data.set("title", values.title); data.set("lesson", values.lesson || "");
          data.set("date", date); data.set("time", time);
          data.set("durationMinutes", String(values.durationMinutes)); data.set("maxParticipants", String(values.maxParticipants));
          data.set("focus", values.focus || "");
          if (values.aiTutor && !tutorOffline) data.set("aiTutor", "on");
          void onSubmit(data);
        }}>
        <h2 id="study-group-dialog-title">{copy.schedule}</h2>
        <p className={layout.lead}>{copy.arrangeLead}</p>
        <div className={layout.contextCard}><strong>{group.title}</strong><span>{group.about}</span></div>
        <Form.Item style={{ marginBottom: 18 }} name="title" label={copy.sessionTitle} normalize={(value: string) => value.slice(0, SESSION_TITLE_MAX)} rules={[{ ...required, whitespace: true }]}>
          <Input name="title" maxLength={SESSION_TITLE_MAX} showCount/>
        </Form.Item>
        <Form.Item style={{ marginBottom: 18 }} name="lesson" label={copy.relatedLesson}>
          <Select style={{ width: "100%" }} allowClear placeholder={copy.selectLesson} options={(group.lessons || []).map(lesson => ({ value: lesson.id, label: lesson.title }))}
            getPopupContainer={popupContainer} open={popup === "lesson"} onOpenChange={open => popupChange("lesson", open)}/>
        </Form.Item>
        <Row gutter={20}>
          <Col xs={24} sm={12}><Form.Item style={{ marginBottom: 18 }} name="date" label={copy.date} rules={[required]}>
            <DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" disabledDate={date => date.isBefore(dayjs().startOf("day"))} getPopupContainer={popupContainer}
              open={popup === "date"} onOpenChange={open => popupChange("date", open)}/>
          </Form.Item></Col>
          <Col xs={24} sm={12}><Form.Item style={{ marginBottom: 18 }} name="time" label={copy.startTime} rules={[required]}>
            <TimePicker style={{ width: "100%" }} format="HH:mm" showNow={false} needConfirm={false} getPopupContainer={popupContainer}
              open={popup === "time"} onOpenChange={open => popupChange("time", open)} disabledTime={() => {
                if (!selectedDate?.isSame(dayjs(), "day")) return {};
                const now = dayjs();
                return { disabledHours: () => Array.from({ length: now.hour() }, (_, hour) => hour),
                  disabledMinutes: hour => hour === now.hour() ? Array.from({ length: now.minute() + 1 }, (_, minute) => minute) : [] };
              }}/>
          </Form.Item></Col>
          <Col xs={24} sm={12}><Form.Item style={{ marginBottom: 18 }} name="durationMinutes" label={copy.duration} rules={[required]}>
            <Select style={{ width: "100%" }} placeholder={copy.selectDuration} options={DURATION_MINUTE_CHOICES.map(minutes => ({ value: minutes, label: fill(copy.plannedDuration, { count: minutes }) }))}
              getPopupContainer={popupContainer} open={popup === "duration"} onOpenChange={open => popupChange("duration", open)}/>
          </Form.Item></Col>
          <Col xs={24} sm={12}><Form.Item style={{ marginBottom: 18 }} name="maxParticipants" label={<>{copy.maxParticipants}<span style={{ marginLeft: 8, color: "#98a2b3", fontSize: 12, fontWeight: 400 }}>{copy.maximumSix}</span></>} rules={[required]}>
            <Select style={{ width: "100%" }} placeholder={copy.selectMaximum} options={[2, 3, 4, 5, 6].map(count => ({ value: count, label: String(count) }))}
              getPopupContainer={popupContainer} open={popup === "people"} onOpenChange={open => popupChange("people", open)}/>
          </Form.Item></Col>
        </Row>
        <Form.Item style={{ marginBottom: 18 }} name="focus" label={copy.focus} normalize={(value: string) => value.slice(0, SESSION_FOCUS_MAX)}>
          <Input.TextArea style={{ minHeight: 80 }} name="focus" maxLength={SESSION_FOCUS_MAX} showCount placeholder={copy.enterFocus} autoSize={{ minRows: 3, maxRows: 6 }}/>
        </Form.Item>
        <div className={`${layout.switch} ${tutorOffline ? layout.switchDisabled : ""}`}>
          <span className={layout.switchLabel}>{copy.aiTutorLabel}{tutorOffline && <Tooltip title={copy.aiTutorOfflineHint} getPopupContainer={popupContainer}><span className={layout.tutorInfo} tabIndex={0} aria-label={copy.aiTutorOfflineHint}><Info size={15} aria-hidden="true"/></span></Tooltip>}</span>
          <span className={layout.switchText}>{copy.enableAiTutor}</span>
          <Form.Item name="aiTutor" valuePropName="checked" noStyle><Switch disabled={busy || tutorOffline} aria-label={copy.enableAiTutor}/></Form.Item>
        </div>
        <Row align="middle" gutter={12} style={{ marginTop: 8 }}>
          <Col span={8}><PortalButton style={{ width: 80, maxWidth: "100%", minHeight: 38, height: 38, fontSize: 14 }} onClick={onCancel} disabled={busy}>{copy.cancel}</PortalButton></Col>
          <Col span={16} style={{ textAlign: "right" }}><PortalButton style={{ width: 200, maxWidth: "100%", minHeight: 38, height: 38, fontSize: 14 }} type="primary" htmlType="submit" loading={busy} disabled={busy}>{copy.scheduleAction}</PortalButton></Col>
        </Row>
        {error && <p className={shared.error} role="alert">{error}</p>}
      </Form>
    </div>
    </ConfigProvider>
  </PortalProvider>;
}
