// Test double for the footer's async server component. It reads `cookies()` and
// awaits AniList, neither of which exists under a client render, so the footer test
// swaps it for a static list with the same heading.
import React from "react";

export default function AiringThisWeek() {
  return React.createElement(
    "div",
    null,
    React.createElement("h5", null, "Airing This Week"),
  );
}
