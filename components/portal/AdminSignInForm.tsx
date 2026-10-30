"use client";

import { useRef, useState } from "react";
import { Lock, Mail, User } from "lucide-react";
import { Alert, Button, Form, Input } from "antd";
import { getMessages } from "@/lib/i18n/messages";

export function AdminSignInForm({ locale }: { locale: "en-GB" | "zh-CN" }) {
  const copy = getMessages(locale);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("Operator");
  const [register, setRegister] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const submitting = useRef(false);

  async function submit() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(register ? "/api/auth/admin/register" : "/api/auth/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, nickname, locale, rememberMe: true })
      });
      const data = await response.json() as { ok?: boolean; code?: string; data?: { verificationRequired?: boolean } };
      if (!response.ok || !data.ok) {
        const message = data.code === "OPERATOR_REQUIRED" ? copy.backoffice.operatorRequired
          : data.code === "AUTHOR_REQUIRED" ? copy.backoffice.authorRequired
          : data.code === "EMAIL_DELIVERY_NOT_CONFIGURED" ? copy.auth.emailDeliveryNotConfigured
          : data.code === "EMAIL_NOT_VERIFIED" ? copy.backoffice.verifyEmail
          : copy.backoffice.signInFailed;
        throw new Error(message);
      }
      if (data.data?.verificationRequired) {
        setNotice(copy.backoffice.verifyEmail);
        submitting.current = false;
        setBusy(false);
        return;
      }
      window.location.assign(`/${locale}/backoffice/courses`);
    } catch (requestError) {
      submitting.current = false;
      setError(requestError instanceof Error ? requestError.message : copy.backoffice.signInFailed);
      setBusy(false);
    }
  }

  return (
    <Form layout="vertical" onFinish={submit} disabled={busy}>
      <Form.Item label={copy.auth.email} htmlFor="admin-email"><Input id="admin-email" type="email" value={email} onChange={event => setEmail(event.target.value)} required autoComplete="email" prefix={<Mail size={18} aria-hidden="true"/>}/></Form.Item>
      {register && <Form.Item label={copy.auth.nickname} htmlFor="admin-nickname"><Input id="admin-nickname" value={nickname} onChange={event => setNickname(event.target.value)} maxLength={40} autoComplete="nickname" prefix={<User size={18} aria-hidden="true"/>}/></Form.Item>}
      <Form.Item label={copy.auth.password} htmlFor="admin-password"><Input.Password id="admin-password" value={password} onChange={event => setPassword(event.target.value)} required minLength={8} autoComplete={register ? "new-password" : "current-password"} prefix={<Lock size={18} aria-hidden="true"/>}/></Form.Item>
      {error && <Alert type="error" title={error} showIcon/>}
      {notice && <Alert type="info" title={notice} showIcon/>}
      <Button block type="primary" htmlType="submit" loading={busy}>{register ? copy.backoffice.createOperator : copy.auth.submitSignIn}</Button>
      <Button block disabled={busy} onClick={() => { setRegister(value => !value); setError(""); setNotice(""); }}>{register ? copy.backoffice.haveOperator : copy.backoffice.firstOperator}</Button>
    </Form>
  );
}
