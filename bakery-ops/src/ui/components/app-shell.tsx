"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { ForecastProvider } from "@/ui/components/providers/forecast-provider";
import { ToastProvider } from "@/ui/components/providers/toast-provider";
import { TopNav } from "@/ui/components/nav/top-nav";
import { ErrorBoundary } from "@/ui/components/shared/error-boundary";
import type { PageId } from "@/ui/constants";

const OverviewPage = dynamic(() => import("@/ui/components/pages/overview-page").then(m => ({ default: m.OverviewPage })), { ssr: false });
const ReviewPage = dynamic(() => import("@/ui/components/pages/review-page").then(m => ({ default: m.ReviewPage })), { ssr: false });
const ProductionPage = dynamic(() => import("@/ui/components/pages/production-page").then(m => ({ default: m.ProductionPage })), { ssr: false });
const TimeslotsPage = dynamic(() => import("@/ui/components/pages/timeslots-page").then(m => ({ default: m.TimeslotsPage })), { ssr: false });
const TrendsPage = dynamic(() => import("@/ui/components/pages/trends-page").then(m => ({ default: m.TrendsPage })), { ssr: false });
const CalendarPage = dynamic(() => import("@/ui/components/pages/calendar-page").then(m => ({ default: m.CalendarPage })), { ssr: false });
const EmpowermentPage = dynamic(() => import("@/ui/components/pages/empowerment-page").then(m => ({ default: m.EmpowermentPage })), { ssr: false });
const SettingsPage = dynamic(() => import("@/ui/components/pages/settings-page").then(m => ({ default: m.SettingsPage })), { ssr: false });

function AppShellInner() {
  const [activePage, setActivePage] = useState<PageId>("overview");

  const navigate = (page: PageId) => setActivePage(page);

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav activePage={activePage} navigate={navigate} />
      <ErrorBoundary>
        <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-6">
          {activePage === "overview" && <OverviewPage navigate={navigate} />}
          {activePage === "review" && <ReviewPage navigate={navigate} />}
          {activePage === "production" && <ProductionPage navigate={navigate} />}
          {activePage === "timeslots" && <TimeslotsPage navigate={navigate} />}
          {activePage === "trends" && <TrendsPage />}
          {activePage === "calendar" && <CalendarPage />}
          {activePage === "empowerment" && <EmpowermentPage />}
          {activePage === "settings" && <SettingsPage />}
        </main>
      </ErrorBoundary>
    </div>
  );
}

export function AppShell() {
  return (
    <ToastProvider>
      <ForecastProvider>
        <AppShellInner />
      </ForecastProvider>
    </ToastProvider>
  );
}
