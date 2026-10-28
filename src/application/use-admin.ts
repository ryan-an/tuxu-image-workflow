import { useEffect, useRef, useState } from "react";

// Ignore responses from a screen that has already been left or superseded.
export function useAdminQuery<T>(
  read: () => Promise<T>,
  dependencies: unknown[],
) {
  const key = JSON.stringify(dependencies);
  const [dataKey, setDataKey] = useState(key);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void read()
      .then((result) => {
        if (active) {
          setData(result);
          setDataKey(key);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [...dependencies, revision]);
  return {
    data: dataKey === key ? data : null,
    error,
    loading,
    refresh: () => setRevision((value) => value + 1),
  };
}

export function useAdminMutation(onSuccess: () => void) {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function run(work: () => Promise<unknown>, message = "操作已完成") {
    if (busy.current) return false;
    busy.current = true;
    setPending(true);
    setError("");
    setNotice("");
    try {
      await work();
      onSuccess();
      setNotice(message);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败，请重试");
      return false;
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return { pending, error, notice, run };
}
