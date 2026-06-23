/**
 * A tiny, dependency-free glob matcher for the workspace reader. Pure (no fs),
 * so the matching rules are unit-testable independently of the Node walker that
 * uses them. Supports exactly what the source globs need: `*` (within a path
 * segment), `**` (across segments), and literals. Other glob features
 * (`?`, `[...]`, braces) are treated as literals — the cockpit's globs never use
 * them, and treating them literally is the safe default.
 */

/** Convert a glob to an anchored RegExp matching a `/`-separated relative path. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
          i++;
          re += "(?:[^/]+/)*"; // `**/` — zero or more full segments
        } else {
          re += ".*"; // trailing `**` — anything, including `/`
        }
      } else {
        re += "[^/]*"; // `*` — within a single segment
      }
    } else if ("/.+^$(){}[]|\\?".includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

/** True when `relPath` matches any of the globs (precompiled per call — globs lists are small). */
export function matchesAnyGlob(relPath: string, globs: readonly string[]): boolean {
  const normalized = relPath.replace(/\\/g, "/");
  return globs.some((g) => globToRegExp(g).test(normalized));
}

/** The literal top-level directory prefixes a glob can touch (for walk pruning). */
export function globRootDirs(globs: readonly string[]): Set<string> {
  const roots = new Set<string>();
  for (const g of globs) {
    const first = g.split("/")[0];
    // A glob that starts with a wildcard could touch any root — signal "all".
    if (first.includes("*")) {
      roots.add("*");
    } else {
      roots.add(first);
    }
  }
  return roots;
}
