import { clerkMiddleware } from "@clerk/nextjs/server";

// Makes the Clerk session available to server components. Access checks live where the data is:
// the (board) layout calls auth.protect(), and every Convex function checks the caller again.
export default clerkMiddleware();

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
