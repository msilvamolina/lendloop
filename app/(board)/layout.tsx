import { ViewerGate } from "@/components/viewer-gate";

// Every page in this group needs a signed-in user (also enforced by proxy.ts and, for data, by Convex).
export default function BoardLayout({ children }: { children: React.ReactNode }) {
  return <ViewerGate>{children}</ViewerGate>;
}
