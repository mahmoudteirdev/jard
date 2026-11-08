import { useEffect, useRef, useState } from "react";
import { Rail } from "./components/Rail";
import { engine, type Drive } from "./engine";
import { RAIL_ITEMS, useRoute, type RouteId } from "./routes";
import { useSession } from "./scan-session";
import { NotBuilt } from "./screens/NotBuilt";
import { ScanScreen } from "./screens/ScanScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { DriveList, StorageScreen } from "./screens/StorageScreen";

const TITLES: Record<RouteId, string> = {
  ...Object.fromEntries(RAIL_ITEMS.map((i) => [i.id, i.name])),
  scan: "الفحص",
} as Record<RouteId, string>;

export function App() {
  const route = useRoute();
  const session = useSession();
  const [drives, setDrives] = useState<Drive[]>([]);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    engine.listDrives().then(setDrives, () => setDrives([]));
  }, []);

  useEffect(() => {
    document.title = `${TITLES[route]} · جَرد`;
  }, [route]);

  const railCurrent: RouteId = route === "scan" ? "storage" : route;

  return (
    <>
      <a className="skip" href="#main" onClick={(e) => (e.preventDefault(), mainRef.current?.focus())}>
        تخطّ إلى المحتوى
      </a>
      <div className="app">
        <Rail current={railCurrent}>
          {(route === "storage" || route === "scan") && <DriveList drives={drives} session={session} />}
        </Rail>
        <main id="main" ref={mainRef} tabIndex={-1} className="main">
          {engine.demo && (
            <p className="note info" role="note">
              <span>وضع العرض: بيانات تجريبية في المتصفح، لا قراءة حقيقية للقرص. افتح التطبيق عبر Tauri لفحص حقيقي.</span>
            </p>
          )}
          {route === "storage" ? (
            <StorageScreen session={session} drives={drives} />
          ) : route === "scan" ? (
            <ScanScreen session={session} />
          ) : route === "settings" ? (
            <SettingsScreen />
          ) : (
            <NotBuilt title={TITLES[route]} />
          )}
        </main>
      </div>
    </>
  );
}
