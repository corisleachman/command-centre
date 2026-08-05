import styles from "./reliability.module.css";

export default function V2Loading() {
  return <main className={styles.shell} aria-live="polite" aria-busy="true">
    <section className={styles.card}>
      <div className={styles.spinner} aria-hidden="true" />
      <span className={styles.eyebrow}>COMMAND CENTRE V2</span>
      <h1>Loading your workspace</h1>
      <p>Bringing together your tasks, plans and initiatives.</p>
      <div className={styles.skeleton} aria-hidden="true"><div className={styles.bar} /><div className={styles.bar} /><div className={styles.bar} /></div>
    </section>
  </main>;
}
