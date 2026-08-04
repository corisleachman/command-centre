import Link from "next/link";
import { CalendarCheck2, Home, Layers3 } from "lucide-react";
import styles from "./v2-nav.module.css";

export default function V2Layout({ children }: { children: React.ReactNode }) {
  return <>
    {children}
    <nav className={styles.dock} aria-label="Command Centre V2 tools">
      <Link href="/v2"><Home size={17} /><span>Dashboard</span></Link>
      <Link href="/v2/planner"><CalendarCheck2 size={17} /><span>Plan today</span></Link>
      <Link href="/v2/initiatives"><Layers3 size={17} /><span>Manage initiatives</span></Link>
    </nav>
  </>;
}
