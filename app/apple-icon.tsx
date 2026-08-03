import { ImageResponse } from "next/og";

export const size = {
  width: 180,
  height: 180,
};

export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <svg
        width="180"
        height="180"
        viewBox="0 0 100 100"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect width="100" height="100" rx="24" fill="#3167e3" />
        <path
          d="M18 29c11-2 23 1 32 9v39c-9-7-20-10-32-8V29Z"
          fill="#fff"
        />
        <path
          d="M82 29c-11-2-23 1-32 9v39c9-7 20-10 32-8V29Z"
          fill="#fff"
        />
        <path
          d="m57 53 7 7 15-17"
          fill="none"
          stroke="#3167e3"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
    size,
  );
}
