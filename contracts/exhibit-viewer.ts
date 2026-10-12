export type ExhibitViewerControls = {
  zoom: (factor: number) => void;
  reset: () => void;
};

export const EXHIBIT_ZOOM = { min: 0.25, max: 4, step: 1.25 } as const;
