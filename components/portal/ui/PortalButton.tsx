"use client";

import React from "react";

import { Button, type ButtonProps } from "antd";

/** Actions only. Navigation continues to use Next Link/AuthNavigationLink. */
export function PortalButton({ className, htmlType = "button", loading, ...props }: ButtonProps) {
  return <Button {...props} htmlType={htmlType} loading={loading}
    aria-busy={loading ? true : undefined}
    className={["portal-control-button", className].filter(Boolean).join(" ")} />;
}
