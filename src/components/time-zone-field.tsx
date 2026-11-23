"use client";

import { useSyncExternalStore } from "react";

const none = () => () => {};

// Hidden field that tells the server which time zone this browser is in.
export function TimeZoneField() {
  const zone = useSyncExternalStore(
    none,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => "UTC",
  );
  return <input type="hidden" name="timezone" value={zone} readOnly />;
}
