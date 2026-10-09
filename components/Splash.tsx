// Store logo for 1 second on page load, then fades out. Pure CSS, so it shows before any JavaScript runs and never
// blocks the counter: the boxes behind it are already focused, and anything typed goes straight in.
// Logo: public/logo.svg, or set NEXT_PUBLIC_LOGO to another file in public/ (e.g. /logo.png).
export default function Splash() {
  const src = process.env.NEXT_PUBLIC_LOGO || '/logo.svg';
  return (
    <div className="splash" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" />
    </div>
  );
}
