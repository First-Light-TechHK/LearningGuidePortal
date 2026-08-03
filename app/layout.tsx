import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Knowledge System",
  description: "LLM-generated, expert-edited knowledge system"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
