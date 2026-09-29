import React from "react";
import { ChevronDown } from "lucide-react";
import type { ShellViewerModel } from "@/lib/shellViewer";

export function ShellViewer({ viewer }: { viewer: ShellViewerModel | null }) {
  if (!viewer) return null;
  return (
    <div className="profile" data-shell-viewer={viewer.name}>
      <img className="avatar" src="/avatar.svg" alt="" />
      <div>
        <div className="profile-name">{viewer.name} <ChevronDown size={13} /></div>
        {viewer.role ? <div className="profile-role">{viewer.role}</div> : null}
      </div>
    </div>
  );
}
