"use client";

import { Alert, Button, Form, Input, Switch, Tag } from "antd";
import { useRef, useState } from "react";

type Settings = { name: string; publishableKey: string; returnUrl: string; paymentNotifications: boolean; secretConfigured: boolean };
type InputSettings = Omit<Settings, "secretConfigured">;

export function PaymentSettingsForm({ initialSettings, copy }: { initialSettings: Settings; copy: { name: string; publishableKey: string; returnUrl: string; notifications: string; secret: string; configured: string; notConfigured: string; save: string; saved: string; error: string } }) {
  const [form] = Form.useForm<InputSettings>();
  const [settings, setSettings] = useState(initialSettings);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false), submitting = useRef(false);

  async function submit(values: InputSettings) {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setMessage(""); setError("");
    try {
      const response = await fetch("/api/backoffice/payment", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
      const data = await response.json() as { ok?: boolean; settings?: Settings; error?: string };
      if (!response.ok || !data.ok || !data.settings) throw new Error(data.error || copy.error);
      setSettings(data.settings); form.setFieldsValue(data.settings); setMessage(copy.saved);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : copy.error); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <Form<InputSettings> form={form} layout="vertical" className="bo-form" initialValues={initialSettings} onFinish={submit} disabled={busy}>
    <Form.Item name="name" label={copy.name} rules={[{ required:true,whitespace:true,message:copy.error }]}><Input/></Form.Item>
    <Form.Item name="publishableKey" label={copy.publishableKey}><Input placeholder="pk_test_..."/></Form.Item>
    <Form.Item name="returnUrl" label={copy.returnUrl}><Input/></Form.Item>
    <Form.Item name="paymentNotifications" label={copy.notifications} valuePropName="checked"><Switch/></Form.Item>
    <p>{copy.secret}: <Tag color={settings.secretConfigured ? "success" : "warning"}>{settings.secretConfigured ? copy.configured : copy.notConfigured}</Tag></p>
    {error && <Alert type="error" title={error} showIcon/>}
    {message && <Alert type="success" title={message} showIcon/>}
    <Button type="primary" htmlType="submit" loading={busy}>{copy.save}</Button>
  </Form>;
}
