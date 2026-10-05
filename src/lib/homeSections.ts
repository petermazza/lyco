export interface HomeSectionData {
  hasGoals: boolean;
  spending: unknown[];
  upcoming: unknown[];
  earlier?: unknown[];
}

export interface SectionVisibility {
  firstRun: boolean;
  rightNow: boolean;
  laterToday: boolean;
  stillOpen: boolean;
  spending: boolean;
  comingUp: boolean;
}

export function deriveSections(data: HomeSectionData): SectionVisibility {
  const hasGoals = data.hasGoals;
  // A user counts as "set up" if they have goals OR any of their own
  // data — someone who only logged a purchase shouldn't see the
  // empty first-run screen hiding their spending bar.
  const isEmpty = !hasGoals && data.spending.length === 0 && data.upcoming.length === 0;

  return {
    firstRun: isEmpty,
    rightNow: hasGoals,
    laterToday: hasGoals,
    stillOpen: (data.earlier?.length ?? 0) > 0,
    spending: data.spending.length > 0,
    comingUp: data.upcoming.length > 0,
  };
}
