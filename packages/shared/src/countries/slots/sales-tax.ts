// Slot `salesTax`: the sales tax components that apply at a place (GST, HST, PST, VAT …).

export interface SalesTaxComponent {
  key: string;
  label: string;
  /** Basis points: 500 = 5 %. */
  rateBp: number;
  /** Added to the parent's components (Medusa's `is_combinable`); otherwise this level replaces them. */
  combinable?: boolean;
  /** Charged on the price plus the components before it (WooCommerce's `compound`). */
  compound?: boolean;
}

/** A level whose components are all combinable adds to the parent's list; any other replaces it. */
export function combineSalesTax(
  parent: readonly SalesTaxComponent[] | undefined,
  own: readonly SalesTaxComponent[],
): readonly SalesTaxComponent[] {
  return own.every((c) => c.combinable) ? [...(parent ?? []), ...own] : own;
}

/** The total rate in basis points: simple components added, then each compound one on top. */
export function salesTaxRateBp(components: readonly SalesTaxComponent[]): number {
  let total = 0;
  for (const c of components) if (!c.compound) total += c.rateBp;
  for (const c of components) if (c.compound) total += (c.rateBp * (10_000 + total)) / 10_000;
  return total;
}

export function salesTaxProblems(components: readonly SalesTaxComponent[]): string[] {
  const out: string[] = [];
  const keys = new Set<string>();
  for (const c of components) {
    if (!Number.isInteger(c.rateBp) || c.rateBp < 0 || c.rateBp > 10_000)
      out.push(`${c.key}: rate must be 0 to 10000 bp`);
    if (keys.has(c.key)) out.push(`${c.key}: listed twice`);
    keys.add(c.key);
  }
  return out;
}
