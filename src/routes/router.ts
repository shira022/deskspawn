/**
 * ルーティング管理 — DeskSpawn Web
 *
 * Stateベースのシンプルなルーター。
 * パッケージ追加不要で / と /app の2ルートを管理する。
 */

import { useState, useEffect } from "react";

export type Route = "/" | "/app";

const ROUTE_KEY = "deskspawn_route";

export function useRouter(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(() => {
    // クエリパラメータでルート判定
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("page") === "app") return "/app";
    }
    return "/";
  });

  const navigate = (r: Route) => {
    setRoute(r);
    localStorage.setItem(ROUTE_KEY, r);
  };

  useEffect(() => {
    const stored = localStorage.getItem(ROUTE_KEY);
    if (stored === "/app") setRoute("/app");
  }, []);

  return [route, navigate];
}
