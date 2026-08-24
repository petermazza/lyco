export interface HomeSectionData {
  hasGoals: boolean;
  spending: unknown[];
  upcoming: unknown[];
}

export interface SectionVisibility {
  firstRun: boolean;
  rightNow: boolean;
  laterToday: boolean;
  spending: boolean;
  comingUp: boolean;
}

export function deriveSections(data: HomeSectionData): SectionVisibility {
  const hasGoals = data.hasGoals;

  return {
    firstRun: !hasGoals,
    rightNow: hasGoals,
    laterToday: hasGoals,
    spending: data.spending.length > 0,
    comingUp: data.upcoming.length > 0,
  };
}
