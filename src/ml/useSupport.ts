import { useEffect, useState } from "react";
import { checkSupport, type Support } from "./device";

/**
 * Whether this browser can run a model that needs these graphics-card features (none: the browser as such). Null until the
 * answer is in, and while `active` is false, so a screen can ask about a model only once the browser itself is known to be fit.
 */
export function useSupport(needs: readonly string[], active = true): Support | null {
  const [support, setSupport] = useState<Support | null>(null);
  const key = needs.join(","); // a new list with the same names is no new question
  useEffect(() => {
    if (!active) return;
    let live = true;
    void checkSupport(undefined, key ? key.split(",") : []).then((result) => live && setSupport(result));
    return () => {
      live = false;
    };
  }, [active, key]);
  return support;
}
