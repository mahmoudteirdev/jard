import { useEffect, useRef, useState } from "react";
import { Rail } from "./components/Rail";
import { ScreenBoundary } from "./components/ScreenBoundary";
import { engine, type Drive } from "./engine";
import { RAIL_ITEMS, useRoute, type RouteId } from "./routes";
import { openSaved, useSession } from "./scan-session";
import { AboutScreen, LicenseScreen, UpdatesQuestion } from "./screens/AboutScreens";
import { CleanupScreen } from "./screens/CleanupScreen";
import { CompareScreen } from "./screens/CompareScreen";
import { DrivesScreen } from "./screens/DrivesScreen";
import { FinderScreen } from "./screens/FinderScreen";
import { OverviewScreen } from "./screens/OverviewScreen";
import { GuardScreen } from "./screens/GuardScreen";
import { HistoryScreen } from "./screens/HistoryScreen";
import { WhySlowScreen } from "./screens/MoreScreens";
import { NotBuilt } from "./screens/NotBuilt";
import { HealthScreen, ProgramsScreen, ReportsScreen, SecurityScreen, TestsScreen } from "./screens/SystemScreens";
import { ScanScreen } from "./screens/ScanScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { DriveList, scanAndShow, StorageScreen } from "./screens/StorageScreen";
import { useSettings } from "./settings";

const TITLES: Record<RouteId, string> = {
  ...Object.fromEntries(RAIL_ITEMS.map((i) => [i.id, i.name])),
  scan: "الفحص",
  guard: "ما قبل الحذف",
  about: "حول جَرد",
  license: "النسخة والتفعيل",
  whyslow: "ليش جهازي بطيء؟",
} as Record<RouteId, string>;

export function App() {
  const route = useRoute();
  const session = useSession();
  const [drives, setDrives] = useState<Drive[]>([]);
  const mainRef = useRef<HTMLElement>(null);

  const { dedupHardlinks, keepResults } = useSettings();

  useEffect(() => {
    engine.listDrives().then(setDrives, () => setDrives([]));
    // Started from Explorer's "Scan with Jard": scan that folder straight away.
    engine.startupFolder().then((folder) => {
      if (folder) {
        void scanAndShow(folder, null, dedupHardlinks, keepResults);
        return;
      }
      // Otherwise pick up where things were: the latest saved result.
      void Promise.all([engine.savedScans(), engine.listDrives()]).then(([saved, list]) => {
        const last = saved[0];
        if (!last) return;
        void openSaved(last, list.find((d) => d.root.toLowerCase() === last.root.toLowerCase()) ?? null).catch(() => {});
      });
    }, () => {});
    // Once, at startup: a settings change must not start a scan.
  }, []);

  useEffect(() => {
    const off = engine.onOpenFolder((folder) => void scanAndShow(folder, null, dedupHardlinks, keepResults));
    return () => void off.then((u) => u());
  }, [dedupHardlinks, keepResults]);

  useEffect(() => {
    document.title = `${TITLES[route]} · جَرد`;
  }, [route]);

  const railCurrent: RouteId = route === "scan" ? "storage" : route === "guard" ? "cleanup" : route === "about" || route === "license" ? "settings" : route === "whyslow" ? "overview" : route;

  return (
    <>
      <a className="skip" href="#main" onClick={(e) => (e.preventDefault(), mainRef.current?.focus())}>
        تخطّ إلى المحتوى
      </a>
      <UpdatesQuestion />
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
          <ScreenBoundary key={route}>
          {route === "storage" ? (
            <StorageScreen session={session} drives={drives} />
          ) : route === "scan" ? (
            <ScanScreen session={session} />
          ) : route === "overview" ? (
            <OverviewScreen session={session} drives={drives} />
          ) : route === "finder" ? (
            <FinderScreen session={session} />
          ) : route === "compare" ? (
            <CompareScreen session={session} />
          ) : route === "drives" ? (
            <DrivesScreen drives={drives} session={session} />
          ) : route === "programs" ? (
            <ProgramsScreen session={session} />
          ) : route === "health" ? (
            <HealthScreen session={session} drives={drives} />
          ) : route === "tests" ? (
            <TestsScreen drives={drives} />
          ) : route === "security" ? (
            <SecurityScreen />
          ) : route === "reports" ? (
            <ReportsScreen session={session} />
          ) : route === "whyslow" ? (
            <WhySlowScreen drives={drives} />
          ) : route === "about" ? (
            <AboutScreen />
          ) : route === "license" ? (
            <LicenseScreen />
          ) : route === "cleanup" ? (
            <CleanupScreen session={session} />
          ) : route === "guard" ? (
            <GuardScreen />
          ) : route === "history" ? (
            <HistoryScreen />
          ) : route === "settings" ? (
            <SettingsScreen />
          ) : (
            <NotBuilt title={TITLES[route]} />
          )}
          </ScreenBoundary>
        </main>
      </div>
    </>
  );
}
