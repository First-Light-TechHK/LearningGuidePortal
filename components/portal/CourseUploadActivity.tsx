"use client";

import { createContext } from "react";

// Uploads in portalled rich-text dialogs also participate in the draft save lock.
export const CourseUploadActivity = createContext<(() => () => void) | null>(null);
