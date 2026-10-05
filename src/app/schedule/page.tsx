import { Suspense } from "react";
import { ScheduleProposalScreen } from "@/components/ScheduleProposalScreen";

export default function Page() {
  return (
    <Suspense>
      <ScheduleProposalScreen />
    </Suspense>
  );
}
