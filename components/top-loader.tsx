"use client";

// Thin progress bar at the top while the next page loads. It follows links by itself; code that navigates uses the
// router from `nextjs-toploader/app` so the bar starts there too. Mounted once, in the root layout.
import NextTopLoader from "nextjs-toploader";
import "./top-loader.css";

const COLOR = "var(--primary)";

export function TopLoader() {
  return (
    <NextTopLoader
      color={COLOR}
      initialPosition={0.08}
      crawlSpeed={200}
      height={3}
      crawl
      showSpinner={false}
      easing="ease"
      speed={200}
      shadow={`0 0 10px ${COLOR}, 0 0 5px ${COLOR}`}
      zIndex={2000}
      showAtBottom={false}
    />
  );
}
