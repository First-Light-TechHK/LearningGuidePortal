"use client";

import { useEffect, useState } from "react";

const COOKIE_PREFERENCE = "learning-guide-cookie-preference";

export function CookiePolicyControls({ copy }: { copy: { rejectOptional: string; acceptOptional: string; saved: string } }) {
  const [preference, setPreference] = useState<string | null>(null);

  useEffect(() => {
    setPreference(window.localStorage.getItem(COOKIE_PREFERENCE));
  }, []);

  function save(value: "essential" | "optional") {
    window.localStorage.setItem(COOKIE_PREFERENCE, value);
    setPreference(value);
  }

  return <div className="cookie-policy-controls"><div className="cookie-policy-actions"><button className="portal-button portal-button-secondary" type="button" onClick={() => save("essential")}>{copy.rejectOptional}</button><button className="portal-button portal-button-primary" type="button" onClick={() => save("optional")}>{copy.acceptOptional}</button></div>{preference ? <p className="cookie-policy-saved" role="status">{copy.saved}</p> : null}</div>;
}
