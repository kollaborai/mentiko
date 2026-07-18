import { cn } from "@/lib/utils";

// The Mentiko glyph — white tile with the dark mentiko mark. Shared by the top
// pill nav and the floating agent bar's parked state so both read as the same
// brand mark. Colors are fixed rather than themed: this is the logo.
// `round` swaps the squircle tile for a full circle (the parked agent bar);
// the nav keeps the default squircle.
export function MentikoMark({
  className,
  round = false,
}: {
  className?: string;
  round?: boolean;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="-4 -5 32 32"
      className={cn("h-6 w-6", className)}
      aria-hidden="true"
    >
      <rect x="-4" y="-5" width="32" height="32" rx={round ? 16 : 6} fill="white" />
      <path
        d="M14.0298 7.04057L11.9145 2.76797L7.37146 2.6136L6.37685 0L13.605 0.246633L17.0205 7.14525L14.0315 7.04412L14.0298 7.04057ZM20.3497 17.9474L12.7883 17.7345L14.2974 15.0961L18.9821 15.2274L21.2769 11.2174L24 11.5669L20.3497 17.9474ZM17.8597 13.9906L16.4783 11.2795L19.0822 7.29785L16.9825 3.17784L18.7231 1.00782L22.0643 7.564L17.8614 13.9924L17.8597 13.9906ZM9.69219 7.20736L5.00755 7.09025L2.72481 11.1073L0 10.7667L3.63307 4.37374L11.1962 4.56359L9.69392 7.20558L9.69219 7.20736ZM4.91603 15.6479L7.09002 19.7288L5.38916 21.9308L1.93049 15.4385L6.01772 8.93378L7.44742 11.6166L4.91603 15.6479ZM10.6074 21.8847L7.07273 15.0499L10.0635 15.0978L12.253 19.3314L16.7995 19.4041L17.8407 22L10.6091 21.8847H10.6074Z"
        fill="#0a0a0a"
      />
    </svg>
  );
}
