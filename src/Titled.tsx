import React from "react";

// Per-route document titles. Wraps each route element so every hard reload
// lands with the right tab text and the browser history shows real page
// names instead of a generic starter title. Lives in its own file so
// router.tsx exports only the router (react-refresh/only-export-components
// gates CI at zero warnings).
export default function Titled({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  React.useEffect(() => {
    document.title = title;
  }, [title]);
  return <>{children}</>;
}
