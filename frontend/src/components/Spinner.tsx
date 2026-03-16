import React from "react";

export default function Spinner(props: { className?: string; label?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={props.className || "h-4 w-4"}
      style={{ animation: "yantu-spin 0.9s linear infinite" }}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label={props.label || "加载中"}
      role="img"
    >
      <path d="M21 12a9 9 0 1 1-9-9" />
    </svg>
  );
}
