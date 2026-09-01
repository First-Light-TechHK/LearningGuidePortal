import type { Metadata } from "next";
import "katex/dist/katex.min.css";
import "./styles.css";

export const metadata: Metadata = {
  title: "Learning Guide",
  description: "Learning Guide production website"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
