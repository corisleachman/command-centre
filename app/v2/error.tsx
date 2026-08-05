"use client";

import Link from "next/link";
import { AlertTriangle, RefreshCcw } from "lucide-react";
import styles from "./reliability.module.css";

export default function V2Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className={styles.shell}>
    <section className={styles.card} role="alert">
      <span className={styles.eyebrow}><AlertTriangle size={16} /> COMMAND CENTRE V2</span>
      <h1>Something did not load properly</h1>
      <p>Your data has not been deleted. Retry the screen first, or return to the V2 dashboard and continue from there.</p>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={reset}><RefreshCcw size={16} /> Try again</button>
        <Link href="/v2" className={styles.secondary}>Back to dashboard</Link>
      </div>
    </section>
  </main>;
}
