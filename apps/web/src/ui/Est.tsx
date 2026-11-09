/** An estimate always carries its marker (05 section 3.1a). Totals never do. */
export function Est() {
  return (
    <abbr title="Estimated from detected stops" className="ml-0.5 cursor-help no-underline">
      *
    </abbr>
  );
}
