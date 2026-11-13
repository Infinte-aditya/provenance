import { useEffect, useState } from "react";

// Runs an async loader whenever deps change; keeps the previous data while reloading (no flicker).
export function useAsync(load, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  useEffect(() => {
    let dead = false;
    load().then(
      (data) => !dead && setState({ loading: false, data, error: null }),
      (error) => !dead && setState({ loading: false, data: null, error })
    );
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}
