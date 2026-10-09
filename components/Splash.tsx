// Store logo for 1 second on page load, then fades out. Pure CSS, so it shows before any JavaScript runs and never
// blocks the counter: the boxes behind it are already focused, and anything typed goes straight in.
// Logo: public/logo.png (greencartires.ca), or set NEXT_PUBLIC_LOGO to another file in public/.
export default function Splash() {
  const src = process.env.NEXT_PUBLIC_LOGO || '/logo.png';
  return (
    <div className="splash" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" width={480} height={71} />
    </div>
  );
}
