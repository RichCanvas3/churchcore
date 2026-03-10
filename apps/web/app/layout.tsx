import type { ReactNode } from "react";
import { AppHeader } from "../components/AppHeader";
import { DemoIdentityProvider } from "../components/DemoIdentityProvider";
import "./globals.css";

export const metadata = {
  title: "Church Agent",
  description: "Single agent with seeker + guide roles",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "ui-sans-serif, system-ui", height: "100dvh", display: "flex", flexDirection: "column" }}>
        <DemoIdentityProvider>
          <AppHeader />
          <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>{children}</div>
        </DemoIdentityProvider>
      </body>
    </html>
  );
}

