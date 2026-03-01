import type { ReactNode } from "react";
import { AppHeader } from "../components/AppHeader";

export const metadata = {
  title: "Church Agent",
  description: "Single agent with seeker + guide roles",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "ui-sans-serif, system-ui", height: "100dvh", display: "flex", flexDirection: "column" }}>
        <AppHeader />
        <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
      </body>
    </html>
  );
}

