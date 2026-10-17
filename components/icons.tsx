const P: Record<string, string> = {
  home: "M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  search: "M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm5 12 5 5",
  bell: "M6 16V11a6 6 0 1 1 12 0v5l2 2H4zm4 4h4",
  doc: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  agents: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20c0-3 3-5 6-5s6 2 6 5m0-4c1-.6 2-1 3-1 3 0 5 2 5 5",
  calendar: "M4 6h16v15H4zM4 10h16M8 3v4M16 3v4",
  chart: "M4 20V4m0 16h16M8 16v-5m4 5V8m4 8v-3",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  gear: "M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm7.4 3a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14.5 2h-5l-.4 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z",
  chevron: "M9 6l6 6-6 6",
  plus: "M12 5v14M5 12h14",
  image: "M4 5h16v14H4zm0 11 5-5 4 4 2-2 5 5M15 9a1 1 0 1 0 0-.1",
  menu: "M4 7h16M4 12h16M4 17h16",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 9c0-4 4-6 8-6s8 2 8 6",
};
export function Icon({ name, className = "size-5" }: { name: keyof typeof P | string; className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={P[name]} /></svg>;
}
