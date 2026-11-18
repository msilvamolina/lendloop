import { auth } from "@clerk/nextjs/server";
import { ViewerGate } from "@/components/viewer-gate";

// Every page in this group needs a signed-in user. Signed-out visitors are sent to sign in;
// the data itself is protected again in each Convex function.
export default async function BoardLayout({ children }: { children: React.ReactNode }) {
  await auth.protect();
  return <ViewerGate>{children}</ViewerGate>;
}
