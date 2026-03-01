import type { ReactNode } from "react";

export const metadata = {
  title: "Church Agent",
  description: "Single agent with seeker + guide roles",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "ui-sans-serif, system-ui" }}>{children}</body>
    </html>
  );
}

