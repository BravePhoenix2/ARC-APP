/** Decorative light and paper grain; never intercepts page interactions. */
export default function Atmosphere() {
  return (
    <div className="atmosphere" aria-hidden="true">
      <div className="atmosphere-light atmosphere-light-one" />
      <div className="atmosphere-light atmosphere-light-two" />
      <div className="atmosphere-grain" />
    </div>
  );
}
