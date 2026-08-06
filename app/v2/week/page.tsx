import { redirect } from "next/navigation";

export default function WeekPlannerRedirect() {
  redirect("/v2/calendar");
}
