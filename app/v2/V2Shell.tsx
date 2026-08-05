"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  CalendarRange,
  CheckSquare2,
  ClipboardList,
  Home,
  Inbox,
  Layers3,
  Menu,
  Plus,
  RefreshCcw,
  Search,
  Target,
  X,
} from "lucide-react";
import { useState } from "react";
import styles from "./v2-shell.module.css";

type NavItem = {
  href: string;
  label: string;
  icon: typeof Home;
  exact?: boolean;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const groups: NavGroup[] = [
  {
    label: "Now",
    items: [
      { href: "/v2", label: "Today", icon: Home, exact: true },
      { href: "/v2/daily", label: "Execute", icon: CheckSquare2 },
    ],
  },
  {
    label: "Plan",
    items: [
      { href: "/v2/planner", label: "Day plan", icon: CalendarDays },
      { href: "/v2/week", label: "Week plan", icon: CalendarRange },
      { href: "/v2/calendar", label: "Calendar", icon: CalendarDays },
      { href: "/v2/review", label: "Review", icon: RefreshCcw },
    ],
  },
  {
    label: "Work",
    items: [
      { href: "/v2/tasks", label: "Tasks", icon: ClipboardList },
      { href: "/v2/initiatives", label: "Initiatives", icon: Layers3 },
      { href: "/v2/objectives", label: "Objectives", icon: Target },
    ],
  },
  {
    label: "Capture",
    items: [
      { href: "/v2/capture", label: "Inbox", icon: Inbox },
    ],
  },
];

const mobileItems: NavItem[] = [
  { href: "/v2", label: "Today", icon: Home, exact: true },
  { href: "/v2/week", label: "Week", icon: CalendarRange },
  { href: "/v2/capture", label: "Add", icon: Plus },
  { href: "/v2/tasks", label: "Tasks", icon: ClipboardList },
];

function isActive(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}

export default function V2Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return <div className={styles.shell}>
    <aside className={`${styles.sidebar} ${open ? styles.sidebarOpen : ""}`}>
      <div className={styles.brandRow}>
        <Link href="/v2" className={styles.brand} onClick={() => setOpen(false)}>
          <span>CC</span>
          <strong>Command Centre<small>V2</small></strong>
        </Link>
        <button className={styles.closeButton} onClick={() => setOpen(false)} aria-label="Close navigation"><X size={19} /></button>
      </div>

      <nav className={styles.nav} aria-label="Command Centre navigation">
        {groups.map(group => <section key={group.label} className={styles.navGroup}>
          <span className={styles.groupLabel}>{group.label}</span>
          {group.items.map(item => {
            const Icon = item.icon;
            const active = isActive(pathname, item);
            return <Link key={item.href} href={item.href} className={active ? styles.active : ""} onClick={() => setOpen(false)}>
              <Icon size={18} />
              <span>{item.label}</span>
            </Link>;
          })}
        </section>)}
      </nav>

      <Link href="/v2/capture" className={styles.quickCapture} onClick={() => setOpen(false)}>
        <Plus size={17} /> Capture something
      </Link>

      <div className={styles.focusCard}>
        <span>Current 90-day focus</span>
        <strong>Stabilise, sell and validate</strong>
        <small>Cash engine first. Song Room validation second. Protect health capacity.</small>
      </div>
    </aside>

    <div className={styles.mainColumn}>
      <div className={styles.mobileTopbar}>
        <button onClick={() => setOpen(true)} aria-label="Open navigation"><Menu size={20} /></button>
        <Link href="/v2">Command Centre</Link>
        <Link href="/v2/capture" aria-label="Capture"><Search size={19} /></Link>
      </div>
      <div className={styles.content}>{children}</div>
    </div>

    {open && <button className={styles.backdrop} onClick={() => setOpen(false)} aria-label="Close navigation" />}

    <nav className={styles.mobileDock} aria-label="Mobile navigation">
      {mobileItems.map(item => {
        const Icon = item.icon;
        const active = isActive(pathname, item);
        return <Link key={item.href} href={item.href} className={active ? styles.activeMobile : ""}>
          <Icon size={18} />
          <span>{item.label}</span>
        </Link>;
      })}
      <button onClick={() => setOpen(true)}><Menu size={18} /><span>More</span></button>
    </nav>
  </div>;
}
