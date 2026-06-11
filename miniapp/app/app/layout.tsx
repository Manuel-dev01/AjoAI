// Mobile-first shell for the MiniPay app surface (≤460px, full-height). Inside MiniPay the
// device shows the real status bar; we don't fake a 9:41 bar here.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <div className="appshell">{children}</div>;
}
