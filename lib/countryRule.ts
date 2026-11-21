// Country visibility rule used by the Identification Type lookup tag:
//   ''            -> all countries
//   '+IN, +US'    -> only IN and US
//   '-US'         -> every country except US        (both may be combined)
export function parseCountryRule(rule: string | null | undefined) {
  const inc: string[] = [], exc: string[] = [];
  for (const t of (rule ?? '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean)) {
    if (t.startsWith('+')) inc.push(t.slice(1).trim());
    else if (t.startsWith('-')) exc.push(t.slice(1).trim());
    else inc.push(t);
  }
  return { inc, exc };
}

export function countryAllowed(rule: string | null | undefined, country: string | null | undefined) {
  if (!country) return true;
  const { inc, exc } = parseCountryRule(rule);
  const c = country.toUpperCase();
  return (!inc.length || inc.includes(c)) && !exc.includes(c);
}
