import "./globals.css";
export const metadata = { title: "NQ Bias", description: "Daily macro + gamma bias for NQ" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
