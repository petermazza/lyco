import { Suspense } from "react";
import { NewProjectScreen } from "@/components/NewProjectScreen";

export default function Page() {
  return (
    <Suspense>
      <NewProjectScreen />
    </Suspense>
  );
}
