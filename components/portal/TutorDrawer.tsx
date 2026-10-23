"use client";

import type { ReactNode } from "react";
import { PortalDialog } from "./PortalDialog";

/** AI Tutor 右侧抽屉：50% 视口宽、满高、左侧圆角；Esc / 遮罩 / 右上角 X 均可关闭。 */
export function TutorDrawer({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return <PortalDialog className="tutor-panel" labelledBy="tutor-panel-title" onClose={onClose} portal closeOnBackdrop>
    {children}
  </PortalDialog>;
}
